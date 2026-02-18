import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenRequest } from '../entities/token-request.entity';
import { User } from '../entities/user.entity';
import { DevelopmentOption } from '../entities/development-option.entity';
import { TokenRequestsService } from './token-requests.service';
import { TokenRequestsController } from './token-requests.controller';
import { TokenBalancesModule } from '../token-balances/token-balances.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TokenRequest, User, DevelopmentOption]),
    TokenBalancesModule, // provides TokenBalancesService
  ],
  controllers: [TokenRequestsController],
  providers: [TokenRequestsService],
  exports: [TokenRequestsService],
})
export class TokenRequestsModule {}
