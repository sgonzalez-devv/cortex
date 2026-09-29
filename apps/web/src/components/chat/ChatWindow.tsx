'use client';

import { useState, useRef, useEffect } from 'react';
import { streamChat, type Message, type MessageSource } from '@/lib/api';

interface Props {
  conversationId: string;
  initialMessages: Message[];
}

export function ChatWindow({ conversationId, initialMessages }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamBuffer]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || streaming) return;

    setInput('');
    setStreaming(true);
    setStreamBuffer('');

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
      sources: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    let sources: MessageSource[] = [];
    let buffer = '';

    try {
      await streamChat(
        conversationId,
        question,
        (token) => {
          buffer += token;
          setStreamBuffer(buffer);
        },
        (s) => { sources = s; },
      );

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: buffer,
        sources,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      setStreamBuffer('');
      setStreaming(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {streaming && streamBuffer && (
          <MessageBubble
            message={{ id: 'streaming', role: 'assistant', content: streamBuffer, sources: null, createdAt: '' }}
            isStreaming
          />
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="border-t p-4 flex gap-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about your documents..."
          disabled={streaming}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {streaming ? 'Thinking...' : 'Send'}
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message, isStreaming }: { message: Message; isStreaming?: boolean }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] space-y-2`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-blue-600 text-white rounded-br-sm'
              : 'bg-gray-100 text-gray-900 rounded-bl-sm'
          }`}
        >
          {message.content}
          {isStreaming && <span className="inline-block w-1 h-4 ml-0.5 bg-current animate-pulse" />}
        </div>

        {message.sources && message.sources.length > 0 && (
          <SourceList sources={message.sources} />
        )}
      </div>
    </div>
  );
}

function SourceList({ sources }: { sources: MessageSource[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="text-xs text-gray-500 ml-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="underline underline-offset-2 hover:text-gray-700"
      >
        {sources.length} source{sources.length > 1 ? 's' : ''} {open ? '▲' : '▼'}
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {sources.map((s, i) => (
            <li key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-2">
              <p className="font-medium text-gray-700 mb-1">{s.documentName}</p>
              <p className="text-gray-500 line-clamp-2">{s.content}</p>
              <p className="text-gray-400 mt-1">similarity: {(s.similarity * 100).toFixed(1)}%</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
