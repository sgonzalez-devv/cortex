import json
import os
import logging
from typing import Generator

import boto3
import pdfplumber
import tiktoken
import psycopg2
import psycopg2.extras
from openai import OpenAI

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")
openai = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
tokenizer = tiktoken.get_encoding("cl100k_base")

CHUNK_SIZE = 512
CHUNK_OVERLAP = 64
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_BATCH = 100


def extract_text(s3_key: str, mime_type: str) -> str:
    bucket = os.environ["S3_DOCUMENTS_BUCKET"]
    obj = s3.get_object(Bucket=bucket, Key=s3_key)
    content = obj["Body"].read()

    if mime_type == "application/pdf":
        import io
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            return "\n\n".join(page.extract_text() or "" for page in pdf.pages)

    return content.decode("utf-8", errors="replace")


def chunk_text(text: str) -> Generator[dict, None, None]:
    tokens = tokenizer.encode(text)
    start = 0

    while start < len(tokens):
        end = min(start + CHUNK_SIZE, len(tokens))
        chunk_tokens = tokens[start:end]
        yield {
            "content": tokenizer.decode(chunk_tokens),
            "token_count": len(chunk_tokens),
            "chunk_index": start // (CHUNK_SIZE - CHUNK_OVERLAP),
        }
        if end >= len(tokens):
            break
        start += CHUNK_SIZE - CHUNK_OVERLAP


def embed_batch(texts: list[str]) -> list[list[float]]:
    response = openai.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [d.embedding for d in response.data]


def get_db_connection():
    return psycopg2.connect(os.environ["DATABASE_URL"], sslmode="require")


def process_document(document_id: str, s3_key: str, mime_type: str) -> int:
    logger.info(f"Processing document {document_id} from {s3_key}")
    conn = get_db_connection()

    try:
        text = extract_text(s3_key, mime_type)
        if not text.strip():
            raise ValueError("Document is empty or could not be parsed")

        chunks = list(chunk_text(text))
        logger.info(f"Split into {len(chunks)} chunks")

        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM document_chunks WHERE document_id = %s",
                (document_id,),
            )

            # Embed in batches to respect OpenAI rate limits
            for batch_start in range(0, len(chunks), EMBEDDING_BATCH):
                batch = chunks[batch_start : batch_start + EMBEDDING_BATCH]
                embeddings = embed_batch([c["content"] for c in batch])

                psycopg2.extras.execute_values(
                    cur,
                    """INSERT INTO document_chunks
                       (document_id, content, embedding, chunk_index, token_count, metadata)
                       VALUES %s""",
                    [
                        (
                            document_id,
                            chunk["content"],
                            f"[{','.join(str(x) for x in emb)}]",
                            chunk["chunk_index"],
                            chunk["token_count"],
                            json.dumps({"batch": batch_start // EMBEDDING_BATCH}),
                        )
                        for chunk, emb in zip(batch, embeddings)
                    ],
                )

            cur.execute(
                """UPDATE documents
                   SET status = 'ready', chunk_count = %s, processed_at = NOW()
                   WHERE id = %s""",
                (len(chunks), document_id),
            )
            conn.commit()

        logger.info(f"Document {document_id} processed: {len(chunks)} chunks embedded")
        return len(chunks)

    except Exception as exc:
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE documents SET status = 'error', error_msg = %s WHERE id = %s",
                (str(exc)[:500], document_id),
            )
            conn.commit()
        raise

    finally:
        conn.close()


def handler(event: dict, _context) -> dict:
    records = event.get("Records", [])
    errors = []

    for record in records:
        body = json.loads(record["body"])
        doc_id = body["documentId"]
        s3_key = body["s3Key"]
        mime_type = body["mimeType"]

        try:
            count = process_document(doc_id, s3_key, mime_type)
            logger.info(f"OK: {doc_id} → {count} chunks")
        except Exception as exc:
            logger.error(f"FAIL: {doc_id} — {exc}")
            errors.append({"documentId": doc_id, "error": str(exc)})

    if errors:
        raise RuntimeError(f"Failed to process {len(errors)} document(s): {errors}")

    return {"statusCode": 200, "processed": len(records)}
