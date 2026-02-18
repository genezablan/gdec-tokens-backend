import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevelopmentOption } from '../entities/development-option.entity';
import { DevelopmentOptionsService } from './development-options.service';
import { DevelopmentOptionsController } from './development-options.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [TypeOrmModule.forFeature([DevelopmentOption]), CommonModule],
  controllers: [DevelopmentOptionsController],
  providers: [DevelopmentOptionsService],
  exports: [DevelopmentOptionsService],
})
export class DevelopmentOptionsModule {}
