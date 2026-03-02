import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

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
   * Generates a pre-signed URL for downloading a private S3 object.
   * URL is valid for the specified number of seconds (default: 15 minutes).
   * The bucket does NOT need to be public.
   */
  async getPresignedDownloadUrl(
    key: string,
    expiresInSeconds = 900,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
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

  /**
   * Pre-upload an attachment before the request is submitted.
   * Stored under token-request-attachments/<userId>/<uuid>/<filename>.
   * Returns the S3 URL and key to be passed in CreateTokenRequestDto.attachmentUrl.
   */
  async uploadPendingAttachment(
    buffer: Buffer,
    userId: string,
    filename: string,
    contentType?: string,
  ): Promise<UploadFileResult> {
    const key = `token-request-attachments/${userId}/${uuidv4()}/${filename}`;
    return this.uploadFile(buffer, key, {
      contentType,
      metadata: { userId, originalFilename: filename },
    });
  }

  /**
   * Generates a pre-signed PUT URL so the browser can upload directly to S3.
   * Returns { uploadUrl, fileUrl, key }.
   * The browser PUTs the file to uploadUrl, then passes fileUrl as attachmentUrl.
   * Expires in 5 minutes.
   */
  async generatePresignedUploadUrl(
    userId: string,
    filename: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; fileUrl: string; key: string }> {
    const key = `token-request-attachments/${userId}/${uuidv4()}/${filename}`;
    const region = this.configService.get<string>('s3.region') || 'ap-southeast-1';

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 300 });
    // Encode each path segment so the URL is valid regardless of filename characters.
    // Forward slashes (folder separators) are NOT encoded.
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    const fileUrl = `https://${this.bucketName}.s3.${region}.amazonaws.com/${encodedKey}`;

    return { uploadUrl, fileUrl, key };
  }

  /**
   * Generates a pre-signed PUT URL for uploading a form template directly from the browser.
   * Key pattern: form-templates/<optionType>/<uuid>/<filename>
   * Expires in 5 minutes.
   */
  async generateFormTemplatePresignedUploadUrl(
    optionType: string,
    filename: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; fileUrl: string; key: string }> {
    const key = `form-templates/${optionType}/${uuidv4()}/${filename}`;
    const region = this.configService.get<string>('s3.region') || 'ap-southeast-1';

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 300 });
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    const fileUrl = `https://${this.bucketName}.s3.${region}.amazonaws.com/${encodedKey}`;

    return { uploadUrl, fileUrl, key };
  }

  /**
   * Generates a pre-signed PUT URL for uploading a profile picture directly from the browser.
   * The caller supplies the already-computed key (profile-pictures/<userId>/<userId>-<ts>.<ext>).
   * Returns { uploadUrl, key } — presigned URL expires in 5 minutes.
   */
  async generateProfilePicturePutUrl(
    key: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; key: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 300 });
    return { uploadUrl, key };
  }
}
