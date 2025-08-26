import { emailService, SystemAlert } from './emailService';
import { logger } from '../utils/logger';
import { storage } from '../storage';

export interface AlertConfiguration {
  level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  recipients: string[];
  enabled: boolean;
  cooldownMinutes: number; // Prevent spam alerts
}

export interface EmailAlertSettings {
  enabled: boolean;
  adminEmails: string[];
  alertConfigs: {
    [key: string]: AlertConfiguration;
  };
}

export class EmailAlertService {
  private settings: EmailAlertSettings;
  private lastAlertTimes: Map<string, Date> = new Map();

  constructor() {
    this.settings = {
      enabled: process.env.EMAIL_ALERTS_ENABLED === 'true',
      adminEmails: this.parseAdminEmails(),
      alertConfigs: {
        CRITICAL: {
          level: 'CRITICAL',
          recipients: this.parseAdminEmails(),
          enabled: true,
          cooldownMinutes: 5 // Critical alerts every 5 minutes max
        },
        ERROR: {
          level: 'ERROR', 
          recipients: this.parseAdminEmails(),
          enabled: true,
          cooldownMinutes: 15 // Error alerts every 15 minutes max
        },
        WARNING: {
          level: 'WARNING',
          recipients: this.parseAdminEmails(),
          enabled: true,
          cooldownMinutes: 60 // Warning alerts every hour max
        },
        INFO: {
          level: 'INFO',
          recipients: this.parseAdminEmails(),
          enabled: false, // Info alerts disabled by default
          cooldownMinutes: 120
        }
      }
    };

    if (this.settings.enabled && this.settings.adminEmails.length > 0) {
      logger.info('email-alert-service', `Email alerts enabled for ${this.settings.adminEmails.length} recipients`, { recipients: this.settings.adminEmails }, 'system', 'ALERT_SERVICE_INIT');
    } else {
      logger.info('email-alert-service', 'Email alerts disabled - no configuration found', {}, 'system', 'ALERT_SERVICE_DISABLED');
    }
  }

  private parseAdminEmails(): string[] {
    const emailsStr = process.env.ADMIN_ALERT_EMAILS || '';
    return emailsStr.split(',').map(email => email.trim()).filter(email => email.length > 0);
  }

  private shouldSendAlert(alertKey: string, config: AlertConfiguration): boolean {
    if (!this.settings.enabled || !config.enabled) {
      return false;
    }

    const now = new Date();
    const lastSent = this.lastAlertTimes.get(alertKey);

    if (lastSent) {
      const cooldownMs = config.cooldownMinutes * 60 * 1000;
      const timeSinceLastAlert = now.getTime() - lastSent.getTime();
      
      if (timeSinceLastAlert < cooldownMs) {
        logger.info('email-alert-service', `Alert suppressed due to cooldown: ${alertKey}`, { cooldownMinutes: config.cooldownMinutes }, 'system', 'ALERT_SUPPRESSED');
        return false;
      }
    }

    return true;
  }

  async sendLogAlert(eventType: string, message: string, details?: any, cid?: string): Promise<boolean> {
    const config = this.settings.alertConfigs[eventType];
    
    if (!config) {
      logger.warning('email-alert-service', `Unknown alert type: ${eventType}`, { eventType }, 'system', 'ALERT_UNKNOWN_TYPE');
      return false;
    }

    const alertKey = `${eventType}-${cid || 'system'}`;
    
    if (!this.shouldSendAlert(alertKey, config)) {
      return false;
    }

    const alert: SystemAlert = {
      level: config.level,
      title: this.generateAlertTitle(eventType, message),
      message,
      details,
      cid
    };

    try {
      const result = await emailService.sendSystemAlert(config.recipients, alert);
      
      if (result.sent > 0) {
        this.lastAlertTimes.set(alertKey, new Date());
        logger.info('email-alert-service', `Alert sent successfully: ${alertKey}`, { sent: result.sent, failed: result.failed }, cid || 'system', 'ALERT_SENT');
        return true;
      } else {
        logger.error('email-alert-service', `Failed to send alert: ${alertKey}`, { result }, cid || 'system', 'ALERT_FAILED');
        return false;
      }
    } catch (error) {
      logger.error('email-alert-service', `Error sending alert: ${alertKey}`, error, cid || 'system', 'ALERT_ERROR');
      return false;
    }
  }

  private generateAlertTitle(eventType: string, message: string): string {
    const titles: { [key: string]: string } = {
      CRITICAL: 'System Critical Error',
      ERROR: 'System Error Detected',
      WARNING: 'System Warning',
      INFO: 'System Information',
      DATABASE_CONNECTION_ERROR: 'Database Connection Failed',
      DISK_SPACE_CRITICAL: 'Disk Space Critical',
      SYNC_SERVICE_ERROR: 'Sync Service Error',
      ENRICHMENT_SERVICE_ERROR: 'Enrichment Service Error',
      API_SERVICE_ERROR: 'API Service Error'
    };

    return titles[eventType] || `System Alert: ${eventType}`;
  }

  async sendDatabaseAlert(error: any, context: string): Promise<boolean> {
    return await this.sendLogAlert('CRITICAL', `Database error in ${context}: ${error.message}`, { 
      error: error.message,
      stack: error.stack?.substring(0, 500),
      context 
    });
  }

  async sendDiskSpaceAlert(usage: number, threshold: number): Promise<boolean> {
    return await this.sendLogAlert('CRITICAL', `Disk space critical: ${usage}% used (threshold: ${threshold}%)`, {
      usage,
      threshold,
      recommendation: 'Immediate cleanup required'
    });
  }

  async sendSyncServiceAlert(service: string, error: any, cid?: string): Promise<boolean> {
    return await this.sendLogAlert('ERROR', `${service} sync failed: ${error.message}`, {
      service,
      error: error.message,
      cid
    }, cid);
  }

  async sendEnrichmentAlert(error: any, batchSize?: number): Promise<boolean> {
    return await this.sendLogAlert('WARNING', `Enrichment service error: ${error.message}`, {
      error: error.message,
      batchSize,
      recommendation: 'Check API connectivity and quotas'
    });
  }

  async testEmailConfiguration(): Promise<{ success: boolean; message: string; details?: any }> {
    if (!this.settings.enabled) {
      return {
        success: false,
        message: 'Email alerts are disabled'
      };
    }

    if (this.settings.adminEmails.length === 0) {
      return {
        success: false,
        message: 'No admin email addresses configured'
      };
    }

    const emailConfig = emailService.getConfiguration();
    if (!emailConfig.isConfigured) {
      return {
        success: false,
        message: 'Email service not configured',
        details: emailConfig
      };
    }

    try {
      const testAlert: SystemAlert = {
        level: 'INFO',
        title: 'Email Configuration Test',
        message: 'This is a test email to verify your alert configuration is working properly.',
        details: {
          timestamp: new Date().toISOString(),
          provider: emailConfig.provider,
          fromEmail: emailConfig.fromEmail
        }
      };

      const result = await emailService.sendSystemAlert(this.settings.adminEmails, testAlert);
      
      return {
        success: result.sent > 0,
        message: `Test email sent to ${result.sent}/${this.settings.adminEmails.length} recipients`,
        details: {
          sent: result.sent,
          failed: result.failed,
          recipients: this.settings.adminEmails,
          emailConfig
        }
      };
    } catch (error) {
      logger.error('email-alert-service', 'Test email failed', error, 'system', 'ALERT_TEST_FAILED');
      return {
        success: false,
        message: 'Test email failed',
        details: error
      };
    }
  }

  getSettings(): EmailAlertSettings {
    return { ...this.settings };
  }

  updateSettings(newSettings: Partial<EmailAlertSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    logger.info('email-alert-service', 'Alert settings updated', { enabled: this.settings.enabled, adminCount: this.settings.adminEmails.length }, 'system', 'ALERT_SETTINGS_UPDATED');
  }
}

export const emailAlertService = new EmailAlertService();