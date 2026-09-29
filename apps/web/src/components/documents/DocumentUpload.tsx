'use client';

import { useCallback, useState } from 'react';
import { uploadFile } from '@/lib/api';

interface Props {
  onUploaded: (documentId: string, name: string) => void;
}

const ALLOWED = ['application/pdf', 'text/plain', 'text/markdown'];
const MAX_MB = 20;

export function DocumentUpload({ onUploaded }: Props) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!ALLOWED.includes(file.type)) {
      setError('Only PDF, plain text, and markdown files are supported.');
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File must be under ${MAX_MB}MB.`);
      return;
    }

    setError(null);
    setUploading(file.name);
    try {
      const documentId = await uploadFile(file);
      onUploaded(documentId, file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(null);
    }
  }, [onUploaded]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl cursor-pointer transition
          ${dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'}`}
      >
        {uploading ? (
          <p className="text-sm text-gray-600">Uploading <strong>{uploading}</strong>…</p>
        ) : (
          <>
            <p className="text-sm text-gray-600">Drop a file here, or <span className="text-blue-600 underline">browse</span></p>
            <p className="text-xs text-gray-400 mt-1">PDF, TXT, MD — up to {MAX_MB}MB</p>
          </>
        )}
        <input
          type="file"
          className="sr-only"
          accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          disabled={!!uploading}
        />
      </label>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
