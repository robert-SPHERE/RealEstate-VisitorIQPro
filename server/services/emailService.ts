import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

// Mailchimp Transactional will be loaded asynchronously
let mailchimpTx: any = null;

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface SystemAlert {
  level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  title: string;
  message: string;
  details?: any;
  cid?: string;
}

export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private mailchimpClient: any = null;
  private fromEmail: string;
  private isConfigured: boolean = false;
  private provider: string = 'none';

  constructor() {
    this.fromEmail = process.env.EMAIL_FROM || 'noreply@visitoriqpro.com';
    this.initializeAsync();
  }

  private async initializeAsync(): Promise<void> {
    await this.loadMailchimpPackage();
    this.setupTransporter();
  }

  private async loadMailchimpPackage(): Promise<void> {
    try {
      // Dynamic import for Mailchimp Transactional
      const mailchimpModule = await import('@mailchimp/mailchimp_transactional');
      mailchimpTx = mailchimpModule.default;
      logger.info('email-service', 'Mailchimp Transactional package loaded', {}, 'system', 'PACKAGE_LOADED');
    } catch (error) {
      logger.warning('email-service', 'Mailchimp Transactional package not available', error, 'system', 'PACKAGE_LOAD_ERROR');
    }
  }

  private setupTransporter(): void {
    // Priority order: Mailchimp Transactional -> SendGrid -> Resend -> Microsoft 365 -> Generic SMTP
    
    if (process.env.MAILCHIMP_TRANSACTIONAL_API_KEY && mailchimpTx) {
      // Mailchimp Transactional (formerly Mandrill) configuration
      try {
        this.mailchimpClient = mailchimpTx(process.env.MAILCHIMP_TRANSACTIONAL_API_KEY);
        this.provider = 'Mailchimp Transactional';
        this.isConfigured = true;
        logger.info('email-service', 'Email configured with Mailchimp Transactional', {}, 'system', 'EMAIL_INIT');
      } catch (error) {
        logger.error('email-service', 'Failed to initialize Mailchimp Transactional', error, 'system', 'EMAIL_INIT_ERROR');
      }
    } else if (process.env.SENDGRID_API_KEY) {
      // SendGrid configuration
      this.transporter = nodemailer.createTransport({
        service: 'SendGrid',
        auth: {
          user: 'apikey',
          pass: process.env.SENDGRID_API_KEY,
        },
      });
      this.provider = 'SendGrid';
      this.isConfigured = true;
      logger.info('email-service', 'Email configured with SendGrid', {}, 'system', 'EMAIL_INIT');
    } else if (process.env.RESEND_API_KEY) {
      // Resend configuration
      this.transporter = nodemailer.createTransport({
        host: 'smtp.resend.com',
        port: 587,
        secure: false,
        auth: {
          user: 'resend',
          pass: process.env.RESEND_API_KEY,
        },
      });
      this.provider = 'Resend';
      this.isConfigured = true;
      logger.info('email-service', 'Email configured with Resend', {}, 'system', 'EMAIL_INIT');
    } else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      // Microsoft 365 / Office 365 SMTP configuration (optimized)
      if (process.env.SMTP_HOST === 'smtp.office365.com' || process.env.SMTP_HOST === 'smtp-mail.outlook.com') {
        this.transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: false, // Office 365 uses STARTTLS on port 587
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
          tls: {
            ciphers: 'SSLv3',
            rejectUnauthorized: false
          },
          requireTLS: true
        });
        this.provider = 'Microsoft 365';
        this.isConfigured = true;
        logger.info('email-service', 'Email configured with Microsoft 365', { host: process.env.SMTP_HOST, user: process.env.SMTP_USER }, 'system', 'EMAIL_INIT');
      } else {
        // Generic SMTP configuration
        this.transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });
        this.provider = 'Generic SMTP';
        this.isConfigured = true;
        logger.info('email-service', 'Email configured with Generic SMTP', { host: process.env.SMTP_HOST }, 'system', 'EMAIL_INIT');
      }
    } else {
      logger.warning('email-service', 'No email configuration found - emails will be logged only', {}, 'system', 'EMAIL_NO_CONFIG');
    }
  }

  hashEmail(email: string): string {
    return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
  }

  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  async sendEmail(to: string, template: EmailTemplate): Promise<boolean> {
    if (!this.isConfigured) {
      logger.warning('email-service', `Email not configured - would send to ${to}: ${template.subject}`, { recipient: to, subject: template.subject }, 'system', 'EMAIL_NOT_SENT');
      console.log(`📧 [EMAIL NOT SENT - NO CONFIG] To: ${to}, Subject: ${template.subject}`);
      console.log(`📧 Content: ${template.text}`);
      return false;
    }

    if (!this.validateEmail(to)) {
      logger.error('email-service', 'Invalid email address', { email: to }, 'system', 'EMAIL_INVALID');
      return false;
    }

    try {
      // Use Mailchimp Transactional if configured
      if (this.mailchimpClient) {
        return await this.sendWithMailchimp(to, template);
      }
      
      // Use nodemailer for other providers
      if (this.transporter) {
        return await this.sendWithNodemailer(to, template);
      }

      logger.error('email-service', 'No email transport configured', {}, 'system', 'EMAIL_NO_TRANSPORT');
      return false;
    } catch (error) {
      logger.error('email-service', `Failed to send email to ${to}`, error, 'system', 'EMAIL_ERROR');
      return false;
    }
  }

  private async sendWithMailchimp(to: string, template: EmailTemplate): Promise<boolean> {
    try {
      const message = {
        from_email: this.fromEmail,
        from_name: 'VisitorIQ Pro',
        subject: template.subject,
        to: [{ email: to, type: 'to' }],
        html: template.html,
        text: template.text,
        tags: ['transactional'],
        track_opens: true,
        track_clicks: true,
        important: template.subject.toLowerCase().includes('alert') || template.subject.toLowerCase().includes('critical')
      };

      const result = await this.mailchimpClient.messages.send({ message });
      
      if (result && result.length > 0 && result[0].status === 'sent') {
        logger.info('email-service', `Email sent successfully via Mailchimp to ${to}`, { messageId: result[0]._id, subject: template.subject }, 'system', 'EMAIL_SENT');
        return true;
      } else {
        logger.error('email-service', `Mailchimp send failed to ${to}`, { result }, 'system', 'EMAIL_ERROR');
        return false;
      }
    } catch (error) {
      logger.error('email-service', `Mailchimp error sending to ${to}`, error, 'system', 'EMAIL_ERROR');
      return false;
    }
  }

  private async sendWithNodemailer(to: string, template: EmailTemplate): Promise<boolean> {
    try {
      const mailOptions = {
        from: this.fromEmail,
        to,
        subject: template.subject,
        text: template.text,
        html: template.html,
      };

      const info = await this.transporter!.sendMail(mailOptions);
      logger.info('email-service', `Email sent successfully via ${this.provider} to ${to}`, { messageId: info.messageId, subject: template.subject }, 'system', 'EMAIL_SENT');
      return true;
    } catch (error) {
      logger.error('email-service', `${this.provider} error sending to ${to}`, error, 'system', 'EMAIL_ERROR');
      return false;
    }
  }

  generatePasswordResetTemplate(resetToken: string, userEmail: string): EmailTemplate {
    // Construct proper frontend URL for different environments
    let frontendUrl: string;
    
    if (process.env.FRONTEND_URL) {
      // Explicitly set frontend URL (highest priority)
      frontendUrl = process.env.FRONTEND_URL;
    } else if (process.env.NODE_ENV === 'production') {
      // Production environment - use custom domain
      frontendUrl = `https://realestate.visitoriqpro.app`;
    } else {
      // Development environment - use dev domain
      frontendUrl = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:5000';
    }
    
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;
    
    const subject = 'VisitorIQ Pro - Password Reset Request';
    
    const text = `
Hello,

You requested a password reset for your VisitorIQ Pro account (${userEmail}).

To reset your password, click the following link or copy it into your browser:
${resetUrl}

This link will expire in 1 hour for security reasons.

If you didn't request this password reset, please ignore this email.

Best regards,
VisitorIQ Pro Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset - VisitorIQ Pro</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { color: #666; font-size: 14px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
    </style>
</head>
<body>
    <div class="header">
        <h1>VisitorIQ Pro</h1>
        <p>Password Reset Request</p>
    </div>
    <div class="content">
        <p>Hello,</p>
        <p>You requested a password reset for your VisitorIQ Pro account (<strong>${userEmail}</strong>).</p>
        <p>Click the button below to reset your password:</p>
        <a href="${resetUrl}" class="button">Reset Password</a>
        <p>Or copy this link into your browser:</p>
        <p style="word-break: break-all; background: #e5e7eb; padding: 10px; border-radius: 4px;">${resetUrl}</p>
        <p><strong>This link will expire in 1 hour</strong> for security reasons.</p>
        <p>If you didn't request this password reset, please ignore this email.</p>
    </div>
    <div class="footer">
        <p>Best regards,<br>VisitorIQ Pro Team</p>
        <p>This is an automated message, please do not reply to this email.</p>
    </div>
</body>
</html>
    `.trim();

    return { subject, text, html };
  }

  generateSystemAlertTemplate(alert: SystemAlert): EmailTemplate {
    const levelColors = {
      INFO: '#22c55e',
      WARNING: '#f59e0b', 
      ERROR: '#ef4444',
      CRITICAL: '#dc2626'
    };

    const levelIcons = {
      INFO: '✅',
      WARNING: '⚠️',
      ERROR: '❌', 
      CRITICAL: '🚨'
    };

    const subject = `${levelIcons[alert.level]} VisitorIQ Pro ${alert.level} Alert: ${alert.title}`;
    
    const text = `
VisitorIQ Pro System Alert

Level: ${alert.level}
Title: ${alert.title}
Time: ${new Date().toISOString()}
${alert.cid ? `CID: ${alert.cid}` : ''}

Message:
${alert.message}

${alert.details ? `Details:\n${JSON.stringify(alert.details, null, 2)}` : ''}

---
VisitorIQ Pro Monitoring System
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>System Alert - VisitorIQ Pro</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: ${levelColors[alert.level]}; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f8fafc; padding: 30px; border: 2px solid ${levelColors[alert.level]}; border-top: none; border-radius: 0 0 8px 8px; }
        .alert-level { background: ${levelColors[alert.level]}; color: white; padding: 8px 16px; border-radius: 20px; display: inline-block; font-weight: bold; margin: 10px 0; }
        .details { background: #e5e7eb; padding: 15px; border-radius: 4px; margin: 15px 0; font-family: monospace; font-size: 12px; }
        .footer { color: #666; font-size: 14px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
    </style>
</head>
<body>
    <div class="header">
        <h1>${levelIcons[alert.level]} VisitorIQ Pro Alert</h1>
        <p>${alert.title}</p>
    </div>
    <div class="content">
        <div class="alert-level">${alert.level}</div>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        ${alert.cid ? `<p><strong>CID:</strong> ${alert.cid}</p>` : ''}
        <p><strong>Message:</strong></p>
        <p>${alert.message}</p>
        ${alert.details ? `<p><strong>Details:</strong></p><div class="details">${JSON.stringify(alert.details, null, 2)}</div>` : ''}
    </div>
    <div class="footer">
        <p>VisitorIQ Pro Monitoring System</p>
        <p>This is an automated alert, please do not reply to this email.</p>
    </div>
</body>
</html>
    `.trim();

    return { subject, text, html };
  }

  async sendPasswordReset(userEmail: string, resetToken: string): Promise<boolean> {
    const template = this.generatePasswordResetTemplate(resetToken, userEmail);
    return await this.sendEmail(userEmail, template);
  }

  async sendSystemAlert(recipients: string[], alert: SystemAlert): Promise<{ sent: number; failed: number }> {
    const template = this.generateSystemAlertTemplate(alert);
    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      const success = await this.sendEmail(recipient, template);
      if (success) {
        sent++;
      } else {
        failed++;
      }
    }

    logger.info('email-service', `System alert sent to ${sent}/${recipients.length} recipients`, { alert: alert.title, level: alert.level }, alert.cid || 'system', 'ALERT_SENT');
    return { sent, failed };
  }

  getConfiguration(): { isConfigured: boolean; provider: string; fromEmail: string; configurationInstructions?: string } {
    const instructions = this.getConfigurationInstructions();
    return {
      isConfigured: this.isConfigured,
      provider: this.provider,
      fromEmail: this.fromEmail,
      configurationInstructions: instructions
    };
  }

  private getConfigurationInstructions(): string {
    if (this.isConfigured) {
      return `✅ Email configured with ${this.provider}`;
    }

    return `
🔧 Mailchimp Transactional Configuration (Recommended):

Required Environment Variables:
• MAILCHIMP_TRANSACTIONAL_API_KEY = Your Mailchimp Transactional API key from https://mandrillapp.com/settings
• EMAIL_FROM = Your verified sending email address (must be verified in Mailchimp)

Setup Steps:
1. Log into your Mailchimp account (Standard plan required)
2. Enable Transactional Email add-on
3. Go to https://mandrillapp.com/settings to generate API key
4. Verify your sending domain in Mailchimp
5. Add the environment variables above

Alternative Options:
• Microsoft 365: SMTP_HOST=smtp.office365.com, SMTP_USER, SMTP_PASS, EMAIL_FROM
• SendGrid: SENDGRID_API_KEY, EMAIL_FROM
• Resend: RESEND_API_KEY, EMAIL_FROM

Priority: Mailchimp Transactional → SendGrid → Resend → Microsoft 365 → Generic SMTP`;
  }
}

export const emailService = new EmailService();
