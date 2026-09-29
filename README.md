# Cortex

> AI-powered knowledge base — upload documents, ask questions, get streaming answers with source citations.

[![CI](https://github.com/sgonzalez-devv/cortex/actions/workflows/ci.yml/badge.svg)](https://github.com/sgonzalez-devv/cortex/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What it does

Cortex turns your documents into a queryable knowledge base. Upload PDFs, markdown, or plain text — the system chunks them, generates vector embeddings, and stores them in PostgreSQL with pgvector. When you ask a question, it retrieves the most semantically relevant chunks and streams an answer with citations back to you.

**Not a chatbot wrapper.** The core is a full RAG (Retrieval-Augmented Generation) pipeline with async document ingestion, semantic chunking, and a real product UI.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Document Ingestion                        │
│                                                                     │
│   User uploads PDF/MD/TXT                                           │
│        │                                                            │
│        ▼                                                            │
│   [NestJS API] ──── PUT ──▶ [S3 bucket]                            │
│        │                         │                                  │
│        └── enqueue ──▶ [SQS] ◀── S3 Event                         │
│                           │                                         │
│                           ▼                                         │
│               [Lambda — Python 3.12]                                │
│               ┌──────────────────────────────┐                     │
│               │  1. Extract text (pdfplumber) │                     │
│               │  2. Semantic chunking         │                     │
│               │  3. OpenAI text-embedding-3   │                     │
│               │  4. Bulk insert → pgvector    │                     │
│               └──────────────────────────────┘                     │
│                           │                                         │
│                           ▼                                         │
│             PostgreSQL + pgvector (RDS)                             │
│             document_chunks.embedding vector(1536)                  │
│             IVFFlat index (cosine similarity)                       │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                           Query Flow                                │
│                                                                     │
│   User sends message                                                │
│        │                                                            │
│        ▼                                                            │
│   [NestJS /chat/stream  SSE endpoint]                               │
│        │                                                            │
│        ├── 1. Embed query (OpenAI)                                  │
│        ├── 2. pgvector cosine search → top 5 chunks                 │
│        ├── 3. Build prompt (system + context + history)             │
│        ├── 4. Stream Claude / GPT-4o response                       │
│        └── 5. Persist message + sources to DB                       │
│                                                                     │
│   [Next.js 14] ◀──── Server-Sent Events (streaming tokens) ────────│
└─────────────────────────────────────────────────────────────────────┘
```

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | Next.js 14, TypeScript, Tailwind, shadcn/ui | Chat UI + document manager |
| API | NestJS, TypeORM, SSE | REST + streaming Q&A endpoint |
| Worker | AWS Lambda, Python 3.12 | Async document processing + embeddings |
| Vector DB | PostgreSQL 16 + pgvector | Semantic search via cosine similarity |
| Storage | AWS S3 | Raw document storage |
| Queue | AWS SQS | Decoupled ingestion pipeline |
| LLM | OpenAI / Anthropic | Embedding + completion |
| IaC | Terraform | All AWS infrastructure |

---

## Local Development

**Prerequisites:** Docker 24+, Node.js 20+, Python 3.12+, an OpenAI or Anthropic API key

```bash
git clone https://github.com/sgonzalez-devv/cortex.git
cd cortex

# Start PostgreSQL (with pgvector) + LocalStack + Redis
docker-compose up -d

# Install API dependencies
cd apps/api && npm ci && cd ../..

# Run migrations (creates tables + pgvector extension + indexes)
cd apps/api && npm run db:migrate && cd ../..

# Start API
cd apps/api && npm run start:dev &

# Start web
cd apps/web && npm ci && npm run dev
```

Visit `http://localhost:3000`.

### Environment variables

```bash
cp apps/api/.env.example apps/api/.env
# Add your OPENAI_API_KEY or ANTHROPIC_API_KEY
```

---

## RAG Pipeline Details

### Chunking strategy

Documents are split using a recursive character splitter with overlap, targeting ~512 tokens per chunk. Chunk boundaries respect paragraph and sentence breaks — splitting mid-sentence degrades retrieval quality.

```
document → paragraphs → sentences → chunks (max 512 tokens, 64 overlap)
```

### Embedding model

`text-embedding-3-small` (1536 dimensions). Dimension reduction to 256 is available via the `dimensions` parameter if storage is a concern — tested with <2% retrieval quality loss on our eval set.

### Retrieval

```sql
SELECT content, metadata,
       1 - (embedding <=> $1::vector) AS similarity
FROM document_chunks
WHERE document_id = ANY($2)
ORDER BY embedding <=> $1::vector
LIMIT 5;
```

IVFFlat index with `lists=100` gives sub-10ms p99 on 1M+ chunks. For >10M chunks, swap to HNSW.

### Prompt construction

```
System: You are a helpful assistant. Answer using ONLY the provided context.
        If the answer is not in the context, say so.

Context:
[chunk 1 — source: document.pdf, page 3]
...

Chat history: (last 6 turns)

User: <question>
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/documents/upload` | Get presigned S3 URL + trigger ingestion |
| GET | `/documents` | List user's documents |
| DELETE | `/documents/:id` | Delete document + chunks |
| POST | `/conversations` | Create conversation |
| GET | `/conversations` | List conversations |
| POST | `/conversations/:id/messages` | Send message (returns full response) |
| GET | `/conversations/:id/stream` | SSE endpoint — streaming tokens |

---

## Tech Decisions

**Why SSE over WebSockets?** SSE is unidirectional (server → client), which is exactly what streaming LLM responses need. No connection upgrade overhead, works through proxies natively, and Next.js App Router has first-class support.

**Why Python for the Lambda worker?** The Python AI ecosystem (pdfplumber, sentence-transformers, tiktoken, LangChain) is significantly more mature than Node.js equivalents. Using the right tool per job is good architecture.

**Why pgvector over Pinecone/Weaviate?** Reduces operational complexity — one database instead of two. For <50M chunks, pgvector with an HNSW index is competitive in latency. Easier to join against other tables (user data, document metadata).

**Why IVFFlat not HNSW?** IVFFlat has lower memory footprint and faster build times for <5M vectors. HNSW is better for high-recall at >10M — worth the switch at scale.

---

## License

MIT
