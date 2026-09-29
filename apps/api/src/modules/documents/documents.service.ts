import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { Document, DocumentStatus } from './entities/document.entity';
import { DocumentChunk } from './entities/document-chunk.entity';
import { randomUUID } from 'crypto';

@Injectable()
export class DocumentsService {
  private readonly s3: S3Client;
  private readonly sqs: SQSClient;
  private readonly bucket: string;
  private readonly queueUrl: string;

  constructor(
    @InjectRepository(Document) private readonly docs: Repository<Document>,
    @InjectRepository(DocumentChunk) private readonly chunks: Repository<DocumentChunk>,
    private readonly config: ConfigService,
  ) {
    this.s3 = new S3Client({ region: config.get('AWS_REGION', 'us-east-1') });
    this.sqs = new SQSClient({ region: config.get('AWS_REGION', 'us-east-1') });
    this.bucket = config.getOrThrow('S3_DOCUMENTS_BUCKET');
    this.queueUrl = config.getOrThrow('SQS_INGESTION_QUEUE_URL');
  }

  async getUploadUrl(userId: string, fileName: string, mimeType: string, sizeBytes: number) {
    const ext = fileName.split('.').pop();
    const s3Key = `documents/${userId}/${randomUUID()}.${ext}`;

    const doc = await this.docs.save(
      this.docs.create({ userId, name: fileName, s3Key, mimeType, sizeBytes }),
    );

    const presignedUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        ContentType: mimeType,
        ContentLength: sizeBytes,
        Metadata: { documentId: doc.id, userId },
      }),
      { expiresIn: 300 },
    );

    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({ documentId: doc.id, s3Key, mimeType }),
        DelaySeconds: 2,
      }),
    );

    return { documentId: doc.id, uploadUrl: presignedUrl, s3Key };
  }

  findAll(userId: string): Promise<Document[]> {
    return this.docs.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async findOne(userId: string, id: string): Promise<Document> {
    const doc = await this.docs.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.userId !== userId) throw new ForbiddenException();
    return doc;
  }

  async remove(userId: string, id: string): Promise<void> {
    const doc = await this.findOne(userId, id);
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: doc.s3Key }));
    await this.docs.remove(doc);
  }

  async semanticSearch(
    query: number[],
    documentIds: string[],
    limit = 5,
  ): Promise<Array<{ content: string; similarity: number; metadata: Record<string, unknown>; documentId: string }>> {
    if (!documentIds.length) return [];

    const vectorLiteral = `[${query.join(',')}]`;

    const results = await this.chunks.manager.query(
      `SELECT
        dc.content,
        dc.metadata,
        dc.document_id,
        1 - (dc.embedding <=> $1::vector) AS similarity
       FROM document_chunks dc
       WHERE dc.document_id = ANY($2::uuid[])
         AND dc.embedding IS NOT NULL
       ORDER BY dc.embedding <=> $1::vector
       LIMIT $3`,
      [vectorLiteral, documentIds, limit],
    );

    return results.map((r: { content: string; metadata: Record<string, unknown>; document_id: string; similarity: string }) => ({
      content: r.content,
      metadata: r.metadata,
      documentId: r.document_id,
      similarity: parseFloat(r.similarity),
    }));
  }
}
