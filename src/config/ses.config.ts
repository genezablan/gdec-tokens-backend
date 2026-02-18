import { registerAs } from '@nestjs/config';

export default registerAs('ses', () => ({
  accessKeyId: process.env.SES_ACCESS_KEY_ID,
  secretAccessKey: process.env.SES_SECRET_ACCESS_KEY,
  region: process.env.SES_REGION || 'ap-southeast-1',
  fromEmail: process.env.SES_FROM_EMAIL || 'tokens@greatdealscorp.com',
  fromDomain: process.env.EMAIL_FROM_DOMAIN || 'greatdealscorp.com',
}));
