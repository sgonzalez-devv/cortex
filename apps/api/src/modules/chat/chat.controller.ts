import {
  Controller, Post, Get, Body, Param, Query, UseGuards,
  ParseUUIDPipe, Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { User } from '../auth/entities/user.entity';
import { CreateConversationDto } from './dto/create-conversation.dto';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateConversationDto) {
    return this.chatService.createConversation(user.id, dto.documentIds, dto.title);
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.chatService.findAll(user.id);
  }

  @Get(':id/messages')
  getHistory(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.getHistory(user.id, id);
  }

  @Sse(':id/stream')
  stream(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('q') question: string,
  ): Observable<MessageEvent> {
    return this.chatService.streamAnswer(user.id, id, question);
  }
}
