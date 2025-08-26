import * as cron from 'node-cron';
// import parseExpression from 'cron-parser'; // Temporary disable due to import issues
import axios from 'axios';
import { storage } from '../storage';
import { enrichAndSave } from './enrichmentService';
import { mailchimpService } from './mailchimpService';
import { logger } from '../utils/logger';

export class ScheduledSyncService {
  private isRunning = false;
  private lastSyncTime: Date | null = null;
  private syncResults: { date: string; synced: number; errors: number } | null = null;

  constructor() {
    this.setupScheduledSync();
  }

  private setupScheduledSync() {
    // Schedule sync for hourly runs from 8:00 AM to 8:00 PM Central Time (13 runs per day)
    // Using timezone-aware cron with America/Chicago timezone
    // This automatically handles CST/CDT transitions
    cron.schedule('0 8-20 * * *', async () => {
      logger.info('sync-service', 'Starting scheduled pixel endpoint sync (hourly 8AM-8PM Central Time)', {}, 'system', 'SYNC_START');
      await this.performScheduledSync();
    }, {
      timezone: "America/Chicago" // This ensures CST/CDT handling
    });

    // Schedule Mailchimp sync for 12:00 AM Central Time every day
    cron.schedule('0 0 * * *', async () => {
      logger.info('mailchimp-service', 'Starting scheduled Mailchimp sync at 12:00 AM Central Time', {}, 'system', 'MC_START');
      await this.performMailchimpSync();
    }, {
      timezone: "America/Chicago" // This ensures CST/CDT handling
    });

    logger.info('sync-service', 'Scheduled sync service initialized - will run hourly 8AM-8PM Central Time (pixel sync) and 12:00 AM Central Time (Mailchimp sync)', {}, 'system', 'SYNC_INIT');
  }

  private async performScheduledSync(): Promise<void> {
    if (this.isRunning) {
      logger.warning('sync-service', 'Sync already running, skipping scheduled sync', {}, 'system', 'SYNC_SKIP');
      return;
    }

    this.isRunning = true;
    let totalSynced = 0;
    let totalErrors = 0;
    const newlySyncedRecords = []; // Track newly synced records for enrichment

    try {
      logger.info('sync-service', 'Starting automated nightly sync process', {}, 'system', 'SYNC_BEGIN');
      
      // Ensure valid OAuth token for enrichment operations
      try {
        const { ensureValidOAuthToken } = await import('./audienceAcuityService');
        const oauthReady = await ensureValidOAuthToken();
        if (oauthReady) {
          console.log(`[${new Date().toISOString()}] ✅ OAuth token refreshed and ready for nightly enrichment operations`);
        } else {
          console.log(`[${new Date().toISOString()}] ⚠️ OAuth token refresh failed - nightly sync will use fallback authentication for enrichment`);
        }
      } catch (error: any) {
        console.log(`[${new Date().toISOString()}] OAuth token refresh error: ${error.message} - continuing with fallback auth`);
      }
      
      // Get all CID accounts in the system, filtering for active accounts only
      const allAccounts = await storage.getCidAccounts();
      const activeAccounts = allAccounts.filter(account => account.status === 'active');
      const inactiveAccounts = allAccounts.filter(account => account.status !== 'active');
      
      console.log(`Found ${allAccounts.length} total CID accounts - ${activeAccounts.length} active, ${inactiveAccounts.length} inactive`);
      
      if (inactiveAccounts.length > 0) {
        console.log(`[${new Date().toISOString()}] Skipping ${inactiveAccounts.length} inactive accounts: ${inactiveAccounts.map(a => `${a.cid} (${a.status})`).join(', ')}`);
      }

      for (const account of activeAccounts) {
        try {
          const cid = account.cid;
          console.log(`[${new Date().toISOString()}] Syncing active CID: ${cid} (${account.accountName})`);

          // 1. Get last synced timestamp from sync_log for delta sync
          const syncLog = await storage.getSyncLog(cid);
          const lastSyncedAt = syncLog?.lastSyncedAt?.toISOString() || null;

          // 2. Build endpoint URL with delta sync parameter
          let endpoint = `https://spheredsgpixel.com/pixelEndpoint?cid=${encodeURIComponent(cid)}`;
          if (lastSyncedAt) {
            endpoint += `&since=${encodeURIComponent(lastSyncedAt)}`;
          }

          console.log(`[${new Date().toISOString()}] Fetching from: ${endpoint} (since: ${lastSyncedAt || "FULL SYNC"})`);

          // 3. Fetch records from the endpoint with delta sync
          const response = await axios.get(endpoint, {
            headers: { 
              'Accept': 'application/json',
              'User-Agent': 'VisitorIQ-Pro/1.0'
            },
            timeout: 30000 // 30 second timeout
          });

          if (Array.isArray(response.data)) {
            let maxTs = lastSyncedAt;
            let syncCount = 0;

            // 4. Upsert each visitor record with proper field mapping
            for (const record of response.data) {
              // Skip records without required fields
              if (!record.md5 || !record.ts) {
                console.warn(`Skipping record without md5 or ts:`, record);
                continue;
              }

              try {
                // Check for existing record
                const existing = await storage.getEmailCaptureByHashAndCid(record.md5, cid);

                // Prepare upsert data (map Worker fields to DB fields)
                const captureData = {
                  hashedEmail: record.md5,
                  cid: record.cid || cid, // Use record CID or account CID
                  url: record.url || null,
                  lastPageViewed: record.url || null, // Populate lastPageViewed with the captured URL
                  ts: record.ts,
                  var1: record.var || null, // Worker 'var' field → 'var1'
                  sessionId: record.gtmcb || null, // Worker 'gtmcb' field → 'sessionId'
                  source: "pixel_endpoint",
                  capturedAt: new Date(),
                  updatedAt: new Date(),
                };

                let newCapture;
                if (!existing) {
                  newCapture = await storage.createEmailCapture(captureData);
                  newlySyncedRecords.push(newCapture); // Track new records for enrichment
                  console.log(`Created new capture for MD5: ${record.md5.substring(0, 8)}...`);
                } else {
                  await storage.updateEmailCapture(existing.id, captureData);
                  newCapture = { ...existing, ...captureData, id: existing.id };
                  console.log(`Updated existing capture for MD5: ${record.md5.substring(0, 8)}...`);
                }

                syncCount++;
                totalSynced++;

                // Track highest timestamp for sync_log update
                if (!maxTs || new Date(record.ts) > new Date(maxTs)) {
                  maxTs = record.ts;
                }
              } catch (recordError) {
                console.error(`Error processing record ${record.md5}:`, recordError);
                totalErrors++;
              }
            }

            // 5. Update sync_log table with new lastSyncedAt and sync count
            // Always update sync timestamp even if no records were processed (for display purposes)
            const syncTimestamp = maxTs || new Date().toISOString();
            await storage.upsertSyncLog(cid, syncTimestamp, syncCount);
            console.log(`[${new Date().toISOString()}] Updated sync log for CID: ${cid}, records: ${syncCount}, timestamp: ${syncTimestamp}`);

            console.log(`[${new Date().toISOString()}] Synced ${syncCount} records for CID: ${cid}`);
          } else {
            console.warn(`[${new Date().toISOString()}] Unexpected response format for CID: ${cid}`, response.data);
          }
        } catch (error) {
          console.error(`[${new Date().toISOString()}] Sync failed for CID ${account.cid}:`, error);
          totalErrors++;
        }
      }

      // Store sync results
      this.lastSyncTime = new Date();
      this.syncResults = {
        date: this.lastSyncTime.toISOString(),
        synced: totalSynced,
        errors: totalErrors
      };

      logger.info('sync-service', `Nightly sync completed. Total synced: ${totalSynced}, Errors: ${totalErrors}`, { totalSynced, totalErrors }, 'system', 'SYNC_COMPLETE');
      
      // Trigger batch enrichment for newly synced records only
      if (newlySyncedRecords.length > 0) {
        logger.info('enrichment-service', `Triggering batch enrichment for ${newlySyncedRecords.length} newly synced records`, { recordCount: newlySyncedRecords.length }, 'system', 'ENRICH_START');
        try {
          const { batchEnrichAndSave } = await import('./enrichmentService');
          
          batchEnrichAndSave(newlySyncedRecords).then(stats => {
            logger.info('enrichment-service', `Nightly enrichment completed: ${stats.enriched} enriched, ${stats.failed} failed`, stats, 'system', 'ENRICH_COMPLETE');
          }).catch(error => {
            logger.error('enrichment-service', 'Error in nightly batch enrichment', error, 'system', 'ENRICH_ERROR');
          });
        } catch (error) {
          logger.error('enrichment-service', 'Error setting up batch enrichment', error, 'system', 'ENRICH_SETUP_ERROR');
        }
      } else {
        logger.info('sync-service', 'No new records captured during sync - no enrichment needed', {}, 'system', 'SYNC_NO_ENRICH');
      }
      
    } catch (error) {
      logger.error('sync-service', 'Error in scheduled sync', error, 'system', 'SYNC_ERROR');
      totalErrors++;
    } finally {
      this.isRunning = false;
    }
  }

  private async performMailchimpSync(): Promise<void> {
    try {
      console.log(`[${new Date().toISOString()}] Starting automated nightly Mailchimp sync (delta sync enabled)...`);
      
      const syncResult = await mailchimpService.syncContactsByCid();
      
      if (syncResult.synced > 0) {
        console.log(`[${new Date().toISOString()}] ✅ Nightly Mailchimp sync completed: ${syncResult.synced} new/updated contacts synced across ${syncResult.cidSynced.length} CID(s)`);
      } else {
        console.log(`[${new Date().toISOString()}] ℹ️ Mailchimp sync completed: No new/updated contacts found to sync`);
      }
      
      if (syncResult.errors > 0) {
        console.log(`[${new Date().toISOString()}] ⚠️ Mailchimp sync completed with ${syncResult.errors} errors`);
      }
      
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Error in scheduled Mailchimp sync:`, error);
    }
  }

  // Manual trigger for testing
  async triggerManualSync(): Promise<{ success: boolean; synced: number; errors: number }> {
    logger.info('sync-service', 'Manual sync trigger requested', {}, 'system', 'SYNC_MANUAL');
    
    if (this.isRunning) {
      logger.warning('sync-service', 'Sync already running, rejecting manual trigger', {}, 'system', 'SYNC_REJECT');
      return { success: false, synced: 0, errors: 0 };
    }

    await this.performScheduledSync();
    
    return {
      success: true,
      synced: this.syncResults?.synced || 0,
      errors: this.syncResults?.errors || 0
    };
  }

  getLastSyncInfo(): { lastSyncTime: Date | null; results: any } {
    return {
      lastSyncTime: this.lastSyncTime,
      results: this.syncResults
    };
  }

  async getStatus(): Promise<{ 
    isRunning: boolean; 
    lastSync: string | null; 
    nextSync: string;
    nextSyncFormatted: string;
    synced: number;
    errors: number;
  }> {
    // Calculate next hourly run between 8:00 AM and 8:00 PM Central Time (handles CST/CDT automatically)
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
    
    // Convert to proper UTC time for storage
    const utcNextRun = new Date(nextRun.toLocaleString("en-US", {timeZone: "America/Chicago"}));
    
    // Format the next sync time with proper CDT/CST detection
    const nextSyncFormatted = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    }).format(nextRun);

    // Get the most recent sync time from database instead of memory
    let lastSyncTime: string | null = null;
    let totalSynced = 0;
    
    try {
      // Get all sync logs and find the most recent one
      const allAccounts = await storage.getCidAccounts();
      let mostRecentSync: Date | null = null;
      
      for (const account of allAccounts) {
        const syncLog = await storage.getSyncLog(account.cid);
        if (syncLog?.lastSyncedAt) {
          if (!mostRecentSync || syncLog.lastSyncedAt > mostRecentSync) {
            mostRecentSync = syncLog.lastSyncedAt;
            totalSynced += syncLog.lastSyncRecords || 0;
          }
        }
      }
      
      lastSyncTime = mostRecentSync?.toISOString() || null;
    } catch (error) {
      logger.error('sync-service', 'Error getting sync status from database', error, 'system', 'SYNC_STATUS_ERROR');
    }

    return {
      isRunning: this.isRunning,
      lastSync: lastSyncTime,
      nextSync: utcNextRun.toISOString(),
      nextSyncFormatted: nextSyncFormatted,
      synced: totalSynced,
      errors: 0
    };
  }
}

export const scheduledSyncService = new ScheduledSyncService();