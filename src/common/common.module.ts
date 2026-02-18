import { Module } from '@nestjs/common';
import { EmailService } from './services/email.service';
import { S3Service } from './services/s3.service';

@Module({
  providers: [EmailService, S3Service],
  exports: [EmailService, S3Service],
})
export class CommonModule {}
