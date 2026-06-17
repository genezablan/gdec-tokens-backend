import { Module } from '@nestjs/common';
import { EmailService } from './services/email.service';
import { S3Service } from './services/s3.service';
import { CommunitySanitizerService } from './services/community-sanitizer.service';

@Module({
  providers: [EmailService, S3Service, CommunitySanitizerService],
  exports: [EmailService, S3Service, CommunitySanitizerService],
})
export class CommonModule {}
