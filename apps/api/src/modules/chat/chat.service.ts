import { Injectable, NotFoundException, ForbiddenException, MessageEvent } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Observable, Subject } from 'rxjs';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Message, MessageSource } from '../conversations/entities/message.entity';
import { Document } from '../documents/entities/document.entity';
import { DocumentsService } from '../documents/documents.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';

export interface StreamEvent {
  type: 'token' | 'sources' | 'done' | 'error';
  data: string;
}

@Injectable()
export class ChatService {
  private readonly openai: OpenAI;

  constructor(
    @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(Document) private readonly documents: Repository<Document>,
    private readonly documentsService: DocumentsService,
    private readonly embeddings: EmbeddingsService,
    private readonly config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: config.getOrThrow('OPENAI_API_KEY') });
  }

  async createConversation(userId: string, documentIds: string[], title?: string): Promise<Conversation> {
    const conv = this.conversations.create({ userId, documentIds, title: title ?? 'New conversation' });
    return this.conversations.save(conv);
  }

  async findAll(userId: string): Promise<Conversation[]> {
    return this.conversations.find({ where: { userId }, order: { updatedAt: 'DESC' } });
  }

  async getHistory(userId: string, conversationId: string): Promise<Message[]> {
    const conv = await this.findConversation(userId, conversationId);
    return this.messages.find({
      where: { conversationId: conv.id },
      order: { createdAt: 'ASC' },
    });
  }

  streamAnswer(userId: string, conversationId: string, userQuestion: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();

    this.executeStream(userId, conversationId, userQuestion, subject).catch((err) => {
      subject.next(new MessageEvent('message', { data: JSON.stringify({ type: 'error', data: err.message }) }));
      subject.complete();
    });

    return subject.asObservable();
  }

  private async executeStream(
    userId: string,
    conversationId: string,
    userQuestion: string,
    subject: Subject<MessageEvent>,
  ): Promise<void> {
    const conv = await this.findConversation(userId, conversationId);

    const [queryEmbedding, history] = await Promise.all([
      this.embeddings.embedText(userQuestion),
      this.messages.find({ where: { conversationId }, order: { createdAt: 'ASC' }, take: 6 }),
    ]);

    const retrievedChunks = await this.documentsService.semanticSearch(queryEmbedding, conv.documentIds, 5);

    const docNames = await this.getDocumentNames(conv.documentIds);
    const sources: MessageSource[] = retrievedChunks.map((c) => ({
      documentId: c.documentId,
      documentName: docNames[c.documentId] ?? 'Unknown',
      content: c.content.slice(0, 200),
      similarity: c.similarity,
    }));

    subject.next(new MessageEvent('message', { data: JSON.stringify({ type: 'sources', data: JSON.stringify(sources) }) }));

    const contextBlock = retrievedChunks
      .map((c, i) => `[Source ${i + 1} — ${docNames[c.documentId] ?? 'doc'}]\n${c.content}`)
      .join('\n\n---\n\n');

    const chatHistory = history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    await this.messages.save(this.messages.create({ conversationId, role: 'user', content: userQuestion }));

    const stream = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      stream: true,
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant. Answer questions using ONLY the provided context.
If the answer is not in the context, say "I couldn't find that in the provided documents."
Always be concise and cite sources by referencing [Source N].

Context:
${contextBlock}`,
        },
        ...chatHistory,
        { role: 'user', content: userQuestion },
      ],
    });

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        fullContent += delta;
        subject.next(new MessageEvent('message', { data: JSON.stringify({ type: 'token', data: delta }) }));
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }

    await this.messages.save(
      this.messages.create({
        conversationId,
        role: 'assistant',
        content: fullContent,
        sources,
        inputTokens,
        outputTokens,
      }),
    );

    await this.conversations.update(conv.id, { updatedAt: new Date() });

    subject.next(new MessageEvent('message', { data: JSON.stringify({ type: 'done', data: '' }) }));
    subject.complete();
  }

  private async findConversation(userId: string, id: string): Promise<Conversation> {
    const conv = await this.conversations.findOne({ where: { id } });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userId !== userId) throw new ForbiddenException();
    return conv;
  }

  private async getDocumentNames(ids: string[]): Promise<Record<string, string>> {
    if (!ids.length) return {};
    const docs = await this.documents.find({ where: { id: In(ids) } });
    return Object.fromEntries(docs.map((d) => [d.id, d.name]));
  }
}
