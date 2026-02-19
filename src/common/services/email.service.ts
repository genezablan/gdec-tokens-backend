import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export interface SendEmailRequest {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  htmlBody?: string;
  textBody?: string;
  fromName?: string;
  replyTo?: string;
}

export interface SendEmailResponse {
  messageId: string;
  success: boolean;
  message: string;
}

@Injectable()
export class EmailService {
  private readonly sesClient: SESClient;
  private readonly fromEmail: string;
  private readonly fromDomain: string;

  constructor(private readonly configService: ConfigService) {
    const accessKeyId = this.configService.get<string>('ses.accessKeyId');
    const secretAccessKey = this.configService.get<string>('ses.secretAccessKey');
    const region = this.configService.get<string>('ses.region') || 'ap-southeast-1';
    this.fromEmail = this.configService.get<string>('ses.fromEmail') || 'tokens@greatdealscorp.com';
    this.fromDomain = this.configService.get<string>('ses.fromDomain') || 'greatdealscorp.com';

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Missing required SES configuration variables');
    }

    this.sesClient = new SESClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  /**
   * Sends an email using AWS SES
   */
  async sendEmail(emailRequest: SendEmailRequest): Promise<SendEmailResponse> {
    try {
      // Validate email request
      this.validateEmailRequest(emailRequest);

      // Prepare recipient lists
      const toAddresses = Array.isArray(emailRequest.to) ? emailRequest.to : [emailRequest.to];
      const ccAddresses = emailRequest.cc
        ? Array.isArray(emailRequest.cc)
          ? emailRequest.cc
          : [emailRequest.cc]
        : [];
      const bccAddresses = emailRequest.bcc
        ? Array.isArray(emailRequest.bcc)
          ? emailRequest.bcc
          : [emailRequest.bcc]
        : [];

      // Prepare from address
      const fromName = emailRequest.fromName || 'GDEC Tokens System';
      const fromAddress = emailRequest.fromName
        ? `${fromName} <${this.fromEmail}>`
        : this.fromEmail;

      // Prepare email content
      const emailBody: {
        Html?: { Charset: string; Data: string };
        Text?: { Charset: string; Data: string };
      } = {};
      
      if (emailRequest.htmlBody) {
        emailBody.Html = {
          Charset: 'UTF-8',
          Data: emailRequest.htmlBody,
        };
      }
      
      if (emailRequest.textBody) {
        emailBody.Text = {
          Charset: 'UTF-8',
          Data: emailRequest.textBody,
        };
      }

      // Create send email command
      const sendEmailCommand = new SendEmailCommand({
        Source: fromAddress,
        Destination: {
          ToAddresses: toAddresses,
          CcAddresses: ccAddresses.length > 0 ? ccAddresses : undefined,
          BccAddresses: bccAddresses.length > 0 ? bccAddresses : undefined,
        },
        Message: {
          Subject: {
            Charset: 'UTF-8',
            Data: emailRequest.subject,
          },
          Body: emailBody,
        },
        ReplyToAddresses: emailRequest.replyTo ? [emailRequest.replyTo] : undefined,
      });

      // Send email
      const response = await this.sesClient.send(sendEmailCommand);

      // Log successful send
      console.log('✅ Email sent successfully:', {
        messageId: response.MessageId,
        to: toAddresses,
        subject: emailRequest.subject,
      });

      return {
        messageId: response.MessageId || '',
        success: true,
        message: 'Email sent successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      console.error('❌ Failed to send email:', {
        error: errorMessage,
        to: emailRequest.to,
        subject: emailRequest.subject,
      });

      return {
        messageId: '',
        success: false,
        message: `Failed to send email: ${errorMessage}`,
      };
    }
  }

  /**
   * Validates email request
   */
  private validateEmailRequest(emailRequest: SendEmailRequest): void {
    if (!emailRequest.to || (Array.isArray(emailRequest.to) && emailRequest.to.length === 0)) {
      throw new Error('Email recipient (to) is required');
    }

    if (!emailRequest.subject) {
      throw new Error('Email subject is required');
    }

    if (!emailRequest.htmlBody && !emailRequest.textBody) {
      throw new Error('Email body (htmlBody or textBody) is required');
    }
  }

  /**
   * Sends a token request notification email
   */
  async sendTokenRequestNotification(
    recipientEmail: string,
    recipientName: string,
    requesterName: string,
    requestType: string,
    tokenAmount: number,
    requestId: string,
  ): Promise<SendEmailResponse> {
    const htmlBody = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .button { 
              display: inline-block; 
              padding: 10px 20px; 
              background-color: #4CAF50; 
              color: white; 
              text-decoration: none; 
              border-radius: 5px; 
              margin-top: 20px;
            }
            .footer { padding: 20px; text-align: center; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>New Token Request</h2>
            </div>
            <div class="content">
              <p>Hello ${recipientName},</p>
              <p>You have received a new token request that requires your approval:</p>
              <ul>
                <li><strong>Requester:</strong> ${requesterName}</li>
                <li><strong>Request Type:</strong> ${requestType}</li>
                <li><strong>Token Amount:</strong> ${tokenAmount}</li>
                <li><strong>Request ID:</strong> ${requestId}</li>
              </ul>
              <p>Please log in to the system to review and approve/reject this request.</p>
              <a href="${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/requests/${requestId}" class="button">
                Review Request
              </a>
            </div>
            <div class="footer">
              <p>This is an automated message from GDEC Tokens System.</p>
              <p>Please do not reply to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const textBody = `
Hello ${recipientName},

You have received a new token request that requires your approval:

Requester: ${requesterName}
Request Type: ${requestType}
Token Amount: ${tokenAmount}
Request ID: ${requestId}

Please log in to the system to review and approve/reject this request.

---
This is an automated message from GDEC Tokens System.
Please do not reply to this email.
    `;

    return this.sendEmail({
      to: recipientEmail,
      subject: `New Token Request: ${requestType} (${tokenAmount} tokens)`,
      htmlBody,
      textBody,
      fromName: 'GDEC Tokens System',
    });
  }

  /**
   * Sends a token request status update email
   */
  async sendTokenRequestStatusUpdate(
    recipientEmail: string,
    recipientName: string,
    requestType: string,
    tokenAmount: number,
    status: 'approved' | 'rejected',
    comments?: string,
  ): Promise<SendEmailResponse> {
    const statusColor = status === 'approved' ? '#4CAF50' : '#f44336';
    const statusText = status === 'approved' ? 'Approved' : 'Rejected';

    const htmlBody = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: ${statusColor}; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            .footer { padding: 20px; text-align: center; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>Token Request ${statusText}</h2>
            </div>
            <div class="content">
              <p>Hello ${recipientName},</p>
              <p>Your token request has been <strong>${status}</strong>:</p>
              <ul>
                <li><strong>Request Type:</strong> ${requestType}</li>
                <li><strong>Token Amount:</strong> ${tokenAmount}</li>
                <li><strong>Status:</strong> ${statusText}</li>
              </ul>
              ${comments ? `<p><strong>Comments:</strong> ${comments}</p>` : ''}
            </div>
            <div class="footer">
              <p>This is an automated message from GDEC Tokens System.</p>
              <p>Please do not reply to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const textBody = `
Hello ${recipientName},

Your token request has been ${status}:

Request Type: ${requestType}
Token Amount: ${tokenAmount}
Status: ${statusText}
${comments ? `Comments: ${comments}` : ''}

---
This is an automated message from GDEC Tokens System.
Please do not reply to this email.
    `;

    return this.sendEmail({
      to: recipientEmail,
      subject: `Token Request ${statusText}: ${requestType}`,
      htmlBody,
      textBody,
      fromName: 'GDEC Tokens System',
    });
  }

  // ─── Token Request Workflow Shortcuts ────────────────────────────────────────

  /**
   * Notify an approver (manager or HR) that a request needs their review.
   */
  async sendRequestNotification(
    approverEmail: string,
    requesterName: string,
    requestType: string,
    requestId: string,
  ): Promise<void> {
    await this.sendTokenRequestNotification(
      approverEmail,
      'Approver',
      requesterName,
      requestType,
      1, // tokenAmount not critical for notification
      requestId,
    );
  }

  /**
   * Notify the employee their request was approved.
   */
  async sendApprovalNotification(
    employeeEmail: string,
    employeeName: string,
    requestType: string,
  ): Promise<void> {
    await this.sendTokenRequestStatusUpdate(
      employeeEmail,
      employeeName,
      requestType,
      1,
      'approved',
    );
  }

  /**
   * Notify the employee their request was rejected with a reason.
   */
  async sendRejectionNotification(
    employeeEmail: string,
    employeeName: string,
    requestType: string,
    comment: string,
  ): Promise<void> {
    await this.sendTokenRequestStatusUpdate(
      employeeEmail,
      employeeName,
      requestType,
      1,
      'rejected',
      comment,
    );
  }
}
