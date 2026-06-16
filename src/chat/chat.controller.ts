import { Body, Controller, Get, Post } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../entities/user.entity';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * POST /api/chat
   * Authenticated: send the conversation history (oldest first) and receive
   * the assistant's reply. Body: { messages: [{ role, content }] }.
   * The assistant can answer data questions (balances, requests, sessions —
   * scoped to the signed-in user; platform analytics for admin/HR only).
   */
  @Post()
  chat(@CurrentUser() user: User, @Body() dto: ChatRequestDto) {
    return this.chatService.chat(dto.messages, user);
  }

  /**
   * GET /api/chat/status
   * Authenticated: lets the frontend hide the chat UI when the AI is not
   * configured.
   */
  @Get('status')
  status() {
    return { available: this.chatService.isConfigured() };
  }
}
