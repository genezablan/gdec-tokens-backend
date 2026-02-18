# AWS Services Setup Guide

This guide explains how AWS S3 and SES are configured in the GDEC Tokens Backend.

## Overview

The project uses two AWS services:

- **Amazon S3**: File storage for token request attachments
- **Amazon SES**: Email service for notifications

## Configuration

### Environment Variables

Add these variables to your `.env` file:

```env
# AWS S3 Configuration
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=<your-aws-access-key-id>
AWS_SECRET_ACCESS_KEY=<your-aws-secret-access-key>
S3_BUCKET_NAME=gdec-tokens

# AWS SES Configuration (Email)
SES_ACCESS_KEY_ID=<your-ses-access-key-id>
SES_SECRET_ACCESS_KEY=<your-ses-secret-access-key>
SES_REGION=ap-southeast-1
SES_FROM_EMAIL=tokens@greatdealscorp.com
EMAIL_FROM_DOMAIN=greatdealscorp.com

# Frontend URL (for email links)
FRONTEND_URL=http://localhost:3000
```

### Config Files

Configuration is centralized in these files:

- `src/config/s3.config.ts` - S3 settings
- `src/config/ses.config.ts` - SES settings

Both configs are loaded globally in `app.module.ts`.

## S3 Service Usage

The S3 service is available in `src/common/services/s3.service.ts`.

### Inject the Service

```typescript
import { S3Service } from '../common/services/s3.service';

@Injectable()
export class YourService {
  constructor(private readonly s3Service: S3Service) {}
}
```

### Upload a File

```typescript
// Generic upload
const result = await this.s3Service.uploadFile(buffer, 'path/to/file.pdf', {
  contentType: 'application/pdf',
  metadata: { userId: '123' },
});

console.log(result.url); // https://gdec-tokens.s3.ap-southeast-1.amazonaws.com/path/to/file.pdf
```

### Upload Token Request Attachment

```typescript
// Specialized method for token requests
const result = await this.s3Service.uploadTokenRequestAttachment(
  fileBuffer,
  userId,
  requestId,
  'invoice.pdf',
  'application/pdf',
);

// File will be stored at: tokens/{year}/{month}/{userId}/{requestId}/invoice.pdf
```

## Email Service Usage

The Email service is available in `src/common/services/email.service.ts`.

### Inject the Service

```typescript
import { EmailService } from '../common/services/email.service';

@Injectable()
export class YourService {
  constructor(private readonly emailService: EmailService) {}
}
```

### Send a Generic Email

```typescript
const response = await this.emailService.sendEmail({
  to: 'user@example.com',
  subject: 'Test Email',
  htmlBody: '<h1>Hello</h1><p>This is a test email.</p>',
  textBody: 'Hello\n\nThis is a test email.',
  fromName: 'GDEC Tokens System',
});

console.log(response.messageId);
console.log(response.success);
```

### Send Token Request Notification

```typescript
await this.emailService.sendTokenRequestNotification(
  'approver@greatdealscorp.com',
  'John Doe',
  'Jane Smith',
  'Task Offloading',
  2,
  'req-123',
);
```

### Send Status Update

```typescript
await this.emailService.sendTokenRequestStatusUpdate(
  'user@greatdealscorp.com',
  'Jane Smith',
  'Learning Subsidy',
  3,
  'approved',
  'Good initiative!',
);
```

## Email Templates

The email service includes pre-built templates for:

1. **Token Request Notification**
   - Sent to approvers when a new request is created
   - Includes requester info, request type, and token amount
   - Contains a link to review the request

2. **Token Request Status Update**
   - Sent to requesters when their request is approved/rejected
   - Includes approval status and optional comments

Both templates are mobile-responsive and include:

- HTML version (with styling)
- Plain text version (fallback)
- Branded color scheme
- Clear call-to-action buttons

## Testing

### Test S3 Upload

```typescript
const testBuffer = Buffer.from('Test file content');
const result = await s3Service.uploadFile(testBuffer, 'test/sample.txt', {
  contentType: 'text/plain',
});
console.log('Uploaded to:', result.url);
```

### Test Email Sending

```typescript
const response = await emailService.sendEmail({
  to: 'your-email@greatdealscorp.com',
  subject: 'Test Email',
  htmlBody: '<p>Test from GDEC Tokens Backend</p>',
  textBody: 'Test from GDEC Tokens Backend',
});
console.log('Email sent:', response.success);
```

## Security Notes

1. **Credentials**: Never commit `.env` file to git. Use `.env.example` for reference.
2. **IAM Permissions**: The AWS access keys should have:
   - S3: `PutObject`, `GetObject` permissions on the bucket
   - SES: `SendEmail`, `SendRawEmail` permissions
3. **Email Domains**: Verify your sending domain in AWS SES console
4. **Bucket Policy**: Ensure S3 bucket has appropriate access policies

## Troubleshooting

### S3 Upload Fails

- Check AWS credentials in `.env`
- Verify bucket name exists
- Ensure IAM user has S3 write permissions
- Check bucket region matches `AWS_REGION`

### Email Not Sending

- Check AWS SES credentials in `.env`
- Verify sender email is verified in SES console
- Check if SES is in sandbox mode (can only send to verified emails)
- Review SES sending quotas and limits
- Check CloudWatch logs for detailed errors

### Email in Spam Folder

- Configure SPF, DKIM, and DMARC records for your domain
- Request production access in SES (move out of sandbox)
- Use a verified domain (not @gmail.com)

## AWS Costs

- **S3**: ~$0.023 per GB/month (first 50TB)
- **SES**: $0.10 per 1,000 emails
- Both services have free tier limits

## References

- [AWS S3 Documentation](https://docs.aws.amazon.com/s3/)
- [AWS SES Documentation](https://docs.aws.amazon.com/ses/)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
