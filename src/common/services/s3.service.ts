import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

export interface UploadFileOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface UploadFileResult {
  url: string;
  key: string;
  bucket: string;
}

@Injectable()
export class S3Service {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(private readonly configService: ConfigService) {
    const accessKeyId = this.configService.get<string>('s3.accessKeyId');
    const secretAccessKey = this.configService.get<string>('s3.secretAccessKey');
    const region = this.configService.get<string>('s3.region') || 'ap-southeast-1';
    this.bucketName = this.configService.get<string>('s3.bucketName') || '';

    if (!accessKeyId || !secretAccessKey || !this.bucketName) {
      throw new Error('Missing required S3 configuration variables');
    }

    this.s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  /**
   * Uploads a file buffer to S3
   * @param buffer - File buffer to upload
   * @param key - S3 object key (path)
   * @param options - Additional upload options
   * @returns Upload result with URL and metadata
   */
  async uploadFile(
    buffer: Buffer,
    key: string,
    options?: UploadFileOptions,
  ): Promise<UploadFileResult> {
    const putObjectCommand = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: options?.contentType || 'application/octet-stream',
      Metadata: options?.metadata,
    });

    try {
      await this.s3Client.send(putObjectCommand);

      const region = this.configService.get<string>('s3.region') || 'ap-southeast-1';
      const url = `https://${this.bucketName}.s3.${region}.amazonaws.com/${key}`;

      return {
        url,
        key,
        bucket: this.bucketName,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to upload file to S3: ${errorMessage}`);
    }
  }

  /**
   * Generates a standardized S3 key for token request attachments
   * @param userId - User ID
   * @param requestId - Request ID
   * @param filename - Original filename
   * @returns S3 key following pattern: tokens/{year}/{month}/{userId}/{requestId}/{filename}
   */
  generateTokenRequestKey(
    userId: string,
    requestId: string,
    filename: string,
  ): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    return `tokens/${year}/${month}/${userId}/${requestId}/${filename}`;
  }

  /**
   * Uploads an attachment for a token request
   * @param buffer - File buffer
   * @param userId - User ID
   * @param requestId - Request ID
   * @param filename - Original filename
   * @param contentType - MIME type
   * @returns Upload result
   */
  async uploadTokenRequestAttachment(
    buffer: Buffer,
    userId: string,
    requestId: string,
    filename: string,
    contentType?: string,
  ): Promise<UploadFileResult> {
    const key = this.generateTokenRequestKey(userId, requestId, filename);

    return this.uploadFile(buffer, key, {
      contentType,
      metadata: {
        userId,
        requestId,
        originalFilename: filename,
      },
    });
  }
}
