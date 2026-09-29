import { Controller, Get, Post, Delete, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DocumentsService } from './documents.service';
import { RequestUploadDto } from './dto/upload.dto';
import { User } from '../auth/entities/user.entity';

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload')
  requestUpload(@CurrentUser() user: User, @Body() dto: RequestUploadDto) {
    return this.documentsService.getUploadUrl(user.id, dto.fileName, dto.mimeType, dto.sizeBytes);
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.documentsService.findAll(user.id);
  }

  @Get(':id')
  findOne(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.findOne(user.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.remove(user.id, id);
  }
}
