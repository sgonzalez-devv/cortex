const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? 'Request failed');
  }
  return res.json();
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ accessToken: string; user: { id: string; email: string; name: string } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    register: (email: string, password: string, name?: string) =>
      request<{ accessToken: string; user: { id: string; email: string } }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      }),
  },

  documents: {
    list: () => request<Document[]>('/documents'),
    requestUpload: (fileName: string, mimeType: string, sizeBytes: number) =>
      request<{ documentId: string; uploadUrl: string }>('/documents/upload', {
        method: 'POST',
        body: JSON.stringify({ fileName, mimeType, sizeBytes }),
      }),
    remove: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),
  },

  conversations: {
    list: () => request<Conversation[]>('/conversations'),
    create: (documentIds: string[], title?: string) =>
      request<Conversation>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ documentIds, title }),
      }),
    messages: (id: string) => request<Message[]>(`/conversations/${id}/messages`),
  },
};

export async function uploadFile(file: File): Promise<string> {
  const { documentId, uploadUrl } = await api.documents.requestUpload(file.name, file.type, file.size);
  await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });
  return documentId;
}

export function streamChat(conversationId: string, question: string, onToken: (t: string) => void, onSources: (s: MessageSource[]) => void): Promise<void> {
  const token = localStorage.getItem('access_token');
  const url = `${BASE}/conversations/${conversationId}/stream?q=${encodeURIComponent(question)}`;

  return new Promise((resolve, reject) => {
    const es = new EventSource(url + (token ? `&token=${token}` : ''));

    es.onmessage = (event) => {
      const parsed: { type: string; data: string } = JSON.parse(event.data);
      if (parsed.type === 'token') onToken(parsed.data);
      if (parsed.type === 'sources') onSources(JSON.parse(parsed.data));
      if (parsed.type === 'done') { es.close(); resolve(); }
      if (parsed.type === 'error') { es.close(); reject(new Error(parsed.data)); }
    };

    es.onerror = () => { es.close(); reject(new Error('Stream connection failed')); };
  });
}

export type { Document, Conversation, Message, MessageSource };

interface Document { id: string; name: string; status: string; chunkCount: number | null; createdAt: string; }
interface Conversation { id: string; title: string; documentIds: string[]; updatedAt: string; }
interface Message { id: string; role: 'user' | 'assistant'; content: string; sources: MessageSource[] | null; createdAt: string; }
interface MessageSource { documentId: string; documentName: string; content: string; similarity: number; }
