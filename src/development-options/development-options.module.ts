import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevelopmentOption } from '../entities/development-option.entity';
import { DevelopmentOptionsService } from './development-options.service';
import { DevelopmentOptionsController } from './development-options.controller';
import { CommonModule } from '../common/common.module';
import { TokenRequestsModule } from '../token-requests/token-requests.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DevelopmentOption]),
    CommonModule,
    // For finalizing requests stranded in the HR queue when an admin turns off
    // that option's HR requirement. TokenRequestsModule does not import this
    // module back, so there's no cycle.
    TokenRequestsModule,
  ],
  controllers: [DevelopmentOptionsController],
  providers: [DevelopmentOptionsService],
  exports: [DevelopmentOptionsService],
})
export class DevelopmentOptionsModule {}
