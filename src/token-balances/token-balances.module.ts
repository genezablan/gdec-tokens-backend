import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenBalance } from '../entities/token-balance.entity';
import { User } from '../entities/user.entity';
import { TokenBalancesService } from './token-balances.service';
import { TokenBalancesController } from './token-balances.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TokenBalance, User])],
  controllers: [TokenBalancesController],
  providers: [TokenBalancesService],
  exports: [TokenBalancesService],
})
export class TokenBalancesModule {}
