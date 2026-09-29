import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn, OneToMany,
} from 'typeorm';

export enum DocumentStatus {
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  name: string;

  @Column({ name: 's3_key' })
  s3Key: string;

  @Column({ name: 'mime_type' })
  mimeType: string;

  @Column({ name: 'size_bytes', nullable: true, type: 'bigint' })
  sizeBytes: number | null;

  @Column({ type: 'enum', enum: DocumentStatus, default: DocumentStatus.PROCESSING })
  status: DocumentStatus;

  @Column({ name: 'chunk_count', nullable: true })
  chunkCount: number | null;

  @Column({ name: 'error_msg', nullable: true, type: 'text' })
  errorMsg: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'processed_at', nullable: true, type: 'timestamptz' })
  processedAt: Date | null;
}
