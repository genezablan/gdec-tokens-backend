import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenBalance } from '../entities/token-balance.entity';
import { TokenRequest } from '../entities/token-request.entity';
import { CoachingSession } from '../entities/coaching-session.entity';
import { User } from '../entities/user.entity';
import { ChatService } from './chat.service';
import { ChatToolsService } from './chat-tools.service';
import { ChatController } from './chat.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TokenBalance, TokenRequest, CoachingSession, User]),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatToolsService],
  exports: [ChatService],
})
export class ChatModule {}
