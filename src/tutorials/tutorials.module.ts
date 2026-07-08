import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tutorial } from '../entities/tutorial.entity';
import { User } from '../entities/user.entity';
import { TutorialsService } from './tutorials.service';
import { TutorialsController } from './tutorials.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [TypeOrmModule.forFeature([Tutorial, User]), CommonModule],
  controllers: [TutorialsController],
  providers: [TutorialsService],
  exports: [TutorialsService],
})
export class TutorialsModule {}
