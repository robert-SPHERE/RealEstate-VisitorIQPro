import { makeJob, getJobStatus, JobKey } from './scheduler';
import { scheduledSyncService } from './scheduledSyncService';
import { handwryttenService } from './handwryttenService';
import { mailchimpService } from './mailchimpService';
import { storage } from '../storage';
import { logger } from '../utils/logger';

// Handler functions that wrap existing logic
async function runSpherePixel() {
  try {
    const result = await scheduledSyncService.triggerManualSync();
    return { 
      ok: result.success, 
      message: result.success ? 'Pixel sync completed' : 'Pixel sync failed', 
      count: result.synced 
    };
  } catch (error: any) {
    logger.error('sphere-pixel-sync', 'SpherePixel sync failed', error, 'system', 'SPHERE_SYNC_ERROR');
    return { ok: false, message: error.message, count: 0 };
  }
}

async function runMailchimp() {
  try {
    console.log(`[Mailchimp] Starting nightly sync at 12:00 AM Central Time`);
    const result = await mailchimpService.syncContactsByCid();
    
    const message = result.synced > 0 
      ? `Synced ${result.synced} contacts across ${result.cidSynced.length} CID(s)`
      : 'No new/updated contacts to sync';
      
    logger.info('mailchimp-sync', message, { synced: result.synced, errors: result.errors }, 'system', 'MC_COMPLETE');
    
    return { 
      ok: result.errors === 0, 
      message, 
      count: result.synced 
    };
  } catch (error: any) {
    logger.error('mailchimp-sync', 'Mailchimp sync failed', error, 'system', 'MC_ERROR');
    return { ok: false, message: error.message, count: 0 };
  }
}

async function runHandwrytten() {
  try {
    console.log(`[Handwrytten] Starting hourly sync for handwritten_connect accounts`);
    
    // Get all CID accounts with "handwritten_connect" account level AND active status
    const allAccounts = await storage.getCidAccounts();
    const handwrittenConnectAccounts = allAccounts.filter(account => 
      account.accountLevel === 'handwritten_connect' && 
      account.status === 'active'
    );
    
    if (handwrittenConnectAccounts.length === 0) {
      console.log(`[Handwrytten] No active handwritten_connect accounts found`);
      return { ok: true, message: 'No active accounts to process', count: 0 };
    }
    
    let totalSent = 0;
    let totalErrors = 0;
    
    for (const account of handwrittenConnectAccounts) {
      try {
        const result = await handwryttenService.syncEnrichedContacts(account.cid);
        if (result.success) {
          totalSent += result.sent || 0;
        } else {
          totalErrors++;
        }
      } catch (accountError) {
        totalErrors++;
        console.error(`[Handwrytten] Error processing ${account.accountName}:`, accountError);
      }
    }
    
    const message = totalSent > 0 
      ? `Sent ${totalSent} handwritten notes`
      : totalErrors > 0 
        ? `Completed with ${totalErrors} errors`
        : 'No new notes to send';
    
    console.log(`[Handwrytten] Hourly sync completed - Sent: ${totalSent}, Errors: ${totalErrors}`);
    
    return { 
      ok: totalErrors === 0, 
      message, 
      count: totalSent 
    };
  } catch (error: any) {
    logger.error('handwrytten-sync', 'Handwrytten sync failed', error, 'system', 'HW_ERROR');
    return { ok: false, message: error.message, count: 0 };
  }
}

// Initialize the new scheduler
export function initializeNewScheduler() {
  console.log('[Enhanced Scheduler] Initializing with proper Central Time handling');
  
  // SpherePixel: Every hour from 8:00 AM to 8:00 PM Central Time (13 syncs per day)
  makeJob({ 
    key: 'spherePixel', 
    cron: '0 8-20 * * *', 
    handler: runSpherePixel, 
    mode: 'Delta Sync' 
  });
  
  // Handwrytten: Every hour from 8:00 AM to 8:00 PM Central Time (13 syncs per day)
  makeJob({ 
    key: 'handwrytten', 
    cron: '0 8-20 * * *', 
    handler: runHandwrytten, 
    mode: 'Delta Sync' 
  });
  
  // Mailchimp: Daily at 12:00 AM Central Time (1 sync per day)
  makeJob({ 
    key: 'mailchimp', 
    cron: '0 0 * * *', 
    handler: runMailchimp, 
    mode: 'Delta Sync' 
  });
  
  console.log('[Enhanced Scheduler] All sync jobs scheduled successfully');
  console.log('✓ SpherePixel: Hourly 8AM-8PM Central (data capture & enrichment)');
  console.log('✓ Handwrytten: Hourly 8AM-8PM Central (handwritten notes)'); 
  console.log('✓ Mailchimp: Daily 12AM Central (email marketing)');
}

// Get status for all jobs
export function getAllSyncStatus() {
  return {
    spherePixel: getJobStatus('spherePixel'),
    mailchimp: getJobStatus('mailchimp'),
    handwrytten: getJobStatus('handwrytten')
  };
}

// Get individual job status
export function getSyncStatus(key: JobKey) {
  return getJobStatus(key);
}