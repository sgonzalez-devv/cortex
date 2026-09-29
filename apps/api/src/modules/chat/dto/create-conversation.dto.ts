import { IsArray, IsUUID, IsString, IsOptional } from 'class-validator';

export class CreateConversationDto {
  @IsArray()
  @IsUUID('4', { each: true })
  documentIds: string[];

  @IsString()
  @IsOptional()
  title?: string;
}
