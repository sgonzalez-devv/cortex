import { IsString, IsNumber, IsPositive, IsIn } from 'class-validator';

const ALLOWED_TYPES = ['application/pdf', 'text/plain', 'text/markdown'];

export class RequestUploadDto {
  @IsString()
  fileName: string;

  @IsIn(ALLOWED_TYPES)
  mimeType: string;

  @IsNumber()
  @IsPositive()
  sizeBytes: number;
}
