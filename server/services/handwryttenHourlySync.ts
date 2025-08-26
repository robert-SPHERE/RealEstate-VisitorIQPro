import * as cron from 'node-cron';
import { storage } from '../storage';
import { handwryttenService } from './handwryttenService';

export class HandwryttenHourlySync {
  private isRunning = false;
  private cronJob: cron.ScheduledTask | null = null;

  constructor() {
    console.log('[HandwryttenHourlySync] Service initialized');
  }

  start() {
    // Schedule hourly runs from 8:00 AM to 8:00 PM Central Time (13 runs per day)
    this.cronJob = cron.schedule('0 8-20 * * *', async () => {
      await this.performHourlySync();
    }, {
      timezone: 'America/Chicago'
    });

    console.log('[HandwryttenHourlySync] Scheduled for hourly runs 8:00 AM - 8:00 PM Central Time');
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log('[HandwryttenHourlySync] Stopped');
    }
  }

  async performHourlySync(): Promise<void> {
    if (this.isRunning) {
      console.log('[HandwryttenHourlySync] Sync already running, skipping');
      return;
    }

    this.isRunning = true;
    console.log('[HandwryttenHourlySync] Starting hourly Handwrytten sync for accounts with "handwritten_connect" level');

    try {
      // Get all CID accounts with "handwritten_connect" account level AND active status
      const allAccounts = await storage.getCidAccounts();
      const handwrittenConnectAccounts = allAccounts.filter(account => 
        account.accountLevel === 'handwritten_connect' && 
        account.status === 'active'
      );
      
      // Log which accounts are being filtered out
      const inactiveHandwrittenAccounts = allAccounts.filter(account => 
        account.accountLevel === 'handwritten_connect' && 
        account.status !== 'active'
      );
      
      if (inactiveHandwrittenAccounts.length > 0) {
        console.log(`[HandwryttenHourlySync] Skipping ${inactiveHandwrittenAccounts.length} inactive handwritten_connect accounts: ${inactiveHandwrittenAccounts.map(a => `${a.cid} (${a.status})`).join(', ')}`);
      }

      if (handwrittenConnectAccounts.length === 0) {
        console.log('[HandwryttenHourlySync] No active handwritten_connect accounts found');
        return;
      }

      console.log(`[HandwryttenHourlySync] Found ${handwrittenConnectAccounts.length} handwritten_connect accounts`);

      // Check each account for new data received in the last hour (for hourly runs)
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);

      let totalSent = 0;
      let totalErrors = 0;

      for (const account of handwrittenConnectAccounts) {
        try {
          console.log(`[HandwryttenHourlySync] Checking account: ${account.accountName} (${account.cid})`);

          // Check if this account received any new identity captures in the last hour
          const emailCaptures = await storage.getEmailCaptures(undefined, account.cid);
          const recentCaptures = emailCaptures.filter(capture => {
            const captureDate = new Date(capture.capturedAt || capture.createdAt || 0);
            return captureDate >= oneHourAgo;
          });

          if (recentCaptures.length === 0) {
            console.log(`[HandwryttenHourlySync] No new data in the last hour for ${account.accountName}, skipping`);
            continue;
          }

          console.log(`[HandwryttenHourlySync] ${account.accountName} received ${recentCaptures.length} new captures in the last hour - triggering Handwrytten sync`);

          // Trigger Handwrytten sync for this CID with their custom settings
          const result = await handwryttenService.syncEnrichedContacts(account.cid);
          
          if (result.success) {
            totalSent += result.sent || 0;
            console.log(`[HandwryttenHourlySync] Successfully sent ${result.sent} handwritten notes for ${account.accountName}`);
          } else {
            totalErrors++;
            console.error(`[HandwryttenHourlySync] Failed to sync ${account.accountName}: ${result.message}`);
          }

        } catch (accountError) {
          totalErrors++;
          console.error(`[HandwryttenHourlySync] Error processing ${account.accountName}:`, accountError);
        }
      }

      console.log(`[HandwryttenHourlySync] Hourly sync completed - Sent: ${totalSent}, Errors: ${totalErrors}`);

    } catch (error) {
      console.error('[HandwryttenHourlySync] Error during hourly sync:', error);
    } finally {
      this.isRunning = false;
    }
  }

  // Manual trigger for testing
  async triggerManualSync(): Promise<{ success: boolean; message: string; sent: number; errors: number }> {
    try {
      await this.performHourlySync();
      return {
        success: true,
        message: 'Manual Handwrytten hourly sync completed',
        sent: 0, // Would need to track this in performHourlySync
        errors: 0
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message,
        sent: 0,
        errors: 1
      };
    }
  }

  getStatus(): { isRunning: boolean; nextRun: string; nextSyncFormatted: string } {
    const now = new Date();
    const chicagoNow = new Date(now.toLocaleString("en-US", {timeZone: "America/Chicago"}));
    
    // Calculate next hourly run between 8:00 AM and 8:00 PM Central Time
    const nextRun = new Date(chicagoNow);
    const currentHour = chicagoNow.getHours();
    
    if (currentHour < 8) {
      // Before 8 AM - next run is at 8 AM today
      nextRun.setHours(8, 0, 0, 0);
    } else if (currentHour >= 20) {
      // After 8 PM - next run is at 8 AM tomorrow
      nextRun.setDate(nextRun.getDate() + 1);
      nextRun.setHours(8, 0, 0, 0);
    } else {
      // Between 8 AM and 8 PM - next run is next hour
      nextRun.setHours(currentHour + 1, 0, 0, 0);
    }

    // Format with proper CDT/CST detection
    const nextSyncFormatted = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    }).format(nextRun);

    return {
      isRunning: this.isRunning,
      nextRun: nextRun.toISOString(),
      nextSyncFormatted: nextSyncFormatted
    };
  }
}

export const handwryttenHourlySync = new HandwryttenHourlySync();

// Legacy export for backward compatibility
export const handwryttenNightlySync = handwryttenHourlySync;