import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenBalance } from '../entities/token-balance.entity';
import { TokenRequest } from '../entities/token-request.entity';
import { User } from '../entities/user.entity';
import { TokenBalancesService } from './token-balances.service';
import { TokenBalancesController } from './token-balances.controller';
import { TokenReminderService } from './token-reminder.service';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TokenBalance, TokenRequest, User]),
    CommonModule,
  ],
  controllers: [TokenBalancesController],
  providers: [TokenBalancesService, TokenReminderService],
  exports: [TokenBalancesService],
})
export class TokenBalancesModule {}
