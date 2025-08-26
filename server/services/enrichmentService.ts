import { storage } from '../storage';
import { enrichWithAudienceAcuity, mapEnrichmentToDbFields } from './audienceAcuityService';

// Enrichment configuration
const ENRICHMENT_CONFIG = {
  MAX_RETRIES: 3,
  RETRY_DELAY_BASE: 1000, // 1 second base delay
  BATCH_SIZE: 10, // Process 10 records at a time
  CONCURRENT_REQUESTS: 3, // Max 3 concurrent API calls
  RETRY_DELAY_MULTIPLIER: 2, // Exponential backoff
};

// Track enrichment statistics
export interface EnrichmentStats {
  total: number;
  enriched: number;
  failed: number;
  skipped: number;
  retried: number;
  errors: Array<{ id: number; md5: string; error: string; retryCount: number }>;
}

/**
 * Determines if an error is retryable (transient) or permanent
 */
function isRetryableError(error: any): boolean {
  const errorMessage = error?.message?.toLowerCase() || '';
  const errorStack = error?.stack?.toLowerCase() || '';
  
  // Permanent errors (don't retry)
  if (errorMessage.includes('api key is not active') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('forbidden') ||
      errorMessage.includes('invalid api key') ||
      errorMessage.includes('404') ||
      errorMessage.includes('all audience acuity endpoints failed')) {
    return false;
  }
  
  // Transient errors (retry)
  if (errorMessage.includes('timeout') ||
      errorMessage.includes('network') ||
      errorMessage.includes('econnreset') ||
      errorMessage.includes('enotfound') ||
      errorMessage.includes('503') ||
      errorMessage.includes('502') ||
      errorMessage.includes('500')) {
    return true;
  }
  
  return false; // Default to not retrying unknown errors
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Enriches a single email capture record with retry logic
 * @param capture - The email capture record to enrich
 * @param retryCount - Current retry attempt (default 0)
 * @returns Promise<{ success: boolean; retried: boolean; error?: string }>
 */
export async function enrichAndSave(capture: any, retryCount: number = 0): Promise<{ success: boolean; retried: boolean; error?: string }> {
  // Skip if no hashed email
  if (!capture.hashedEmail) {
    return { success: true, retried: false };
  }
  
  // Check if record actually has enriched data, not just 'completed' status
  const hasActualEnrichedData = capture.firstName && capture.lastName && capture.email &&
    capture.firstName !== 'N/A' && capture.lastName !== 'N/A' && capture.email !== 'N/A' &&
    capture.firstName !== '' && capture.lastName !== '' && capture.email !== '' &&
    capture.firstName !== null && capture.lastName !== null && capture.email !== null;
    
  if (capture.enrichmentStatus === 'completed' && hasActualEnrichedData) {
    return { success: true, retried: false };
  }

  const md5Short = capture.hashedEmail.substring(0, 8);
  console.log(`[${new Date().toISOString()}] Starting enrichment for MD5: ${md5Short}... (ID: ${capture.id}) ${retryCount > 0 ? `(Retry ${retryCount}/${ENRICHMENT_CONFIG.MAX_RETRIES})` : ''}`);

  try {
    // Get enrichment data from Audience Acuity
    const enrichment = await enrichWithAudienceAcuity(capture.hashedEmail);
    
    if (enrichment) {
      // Map enrichment data to database fields, passing original MD5 to match correct email
      const enrichmentFields = mapEnrichmentToDbFields(enrichment, capture.hashedEmail);
      
      // Debug: Log the enrichment data being saved
      // Debug: Enrichment data processing completed
      
      // Update the database record with enriched data
      await storage.updateEmailCapture(capture.id, enrichmentFields);
      
      console.log(`[${new Date().toISOString()}] ✅ Successfully enriched MD5: ${md5Short}... (ID: ${capture.id}) ${retryCount > 0 ? `after ${retryCount} retries` : ''}`);
      return { success: true, retried: retryCount > 0 };
    } else {
      // Mark as failed if no enrichment data found (don't retry - data not available)
      await storage.updateEmailCapture(capture.id, {
        enrichmentStatus: "failed",
        enrichmentError: "No enrichment data available",
        updatedAt: new Date(),
      });
      
      console.log(`[${new Date().toISOString()}] ❌ No enrichment data found for MD5: ${md5Short}... (ID: ${capture.id})`);
      return { success: false, retried: false, error: "No enrichment data available" };
    }
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown error';
    console.error(`[${new Date().toISOString()}] ❌ Enrichment error for MD5 ${md5Short}... (ID: ${capture.id}):`, errorMessage);
    
    // Check if error is retryable and we haven't exceeded max retries
    if (isRetryableError(error) && retryCount < ENRICHMENT_CONFIG.MAX_RETRIES) {
      const delayMs = ENRICHMENT_CONFIG.RETRY_DELAY_BASE * Math.pow(ENRICHMENT_CONFIG.RETRY_DELAY_MULTIPLIER, retryCount);
      console.log(`[${new Date().toISOString()}] 🔄 Retrying enrichment for MD5 ${md5Short}... in ${delayMs}ms (attempt ${retryCount + 1}/${ENRICHMENT_CONFIG.MAX_RETRIES})`);
      
      await sleep(delayMs);
      return await enrichAndSave(capture, retryCount + 1);
    }
    
    // Mark as permanently failed
    await storage.updateEmailCapture(capture.id, {
      enrichmentStatus: "failed",
      enrichmentError: errorMessage.substring(0, 500), // Limit error message length
      retryCount: retryCount,
      updatedAt: new Date(),
    });
    
    return { success: false, retried: retryCount > 0, error: errorMessage };
  }
}

/**
 * Process enrichment queue with concurrency control
 */
async function processEnrichmentQueue(queue: any[]): Promise<{ success: boolean; retried: boolean; error?: string }[]> {
  const results: { success: boolean; retried: boolean; error?: string }[] = [];
  
  // Process in batches with concurrency control
  for (let i = 0; i < queue.length; i += ENRICHMENT_CONFIG.CONCURRENT_REQUESTS) {
    const batch = queue.slice(i, i + ENRICHMENT_CONFIG.CONCURRENT_REQUESTS);
    
    // Process batch concurrently
    const batchResults = await Promise.allSettled(
      batch.map(capture => enrichAndSave(capture))
    );
    
    // Extract results and handle any rejected promises
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.error(`[${new Date().toISOString()}] Promise rejected in batch processing:`, result.reason);
        results.push({ success: false, retried: false, error: result.reason?.message || 'Promise rejection' });
      }
    }
    
    // Small delay between batches to prevent overwhelming the API
    if (i + ENRICHMENT_CONFIG.CONCURRENT_REQUESTS < queue.length) {
      await sleep(200); // 200ms delay between batches
    }
  }
  
  return results;
}

/**
 * Enhanced batch enrichment with comprehensive monitoring and error handling
 * @param captures - Array of email capture records to enrich
 * @returns Promise<EnrichmentStats> - Detailed statistics and error information
 */
export async function batchEnrichAndSave(captures: any[]): Promise<EnrichmentStats> {
  const stats: EnrichmentStats = {
    total: captures.length,
    enriched: 0,
    failed: 0,
    skipped: 0,
    retried: 0,
    errors: []
  };

  // Starting enhanced batch enrichment - debug logs removed during cleanup

  // Filter out records that truly don't need enrichment (more aggressive detection)
  const needsEnrichment = captures.filter(capture => {
    // Must have a valid MD5 hash
    if (!capture.hashedEmail || capture.hashedEmail.length === 0) {
      return false;
    }
    
    // Check if enrichment is needed based on multiple criteria - same as bulk enrichment endpoint
    const hasNoEnrichmentStatus = !capture.enrichmentStatus;
    const hasFailedStatus = capture.enrichmentStatus === 'pending' || capture.enrichmentStatus === 'failed';
    const hasNoEnrichedData = !capture.email && !capture.firstName && !capture.lastName;
    const hasNAValues = capture.firstName === 'N/A' || capture.lastName === 'N/A' || capture.email === 'N/A';
    const hasEmptyStrings = capture.firstName === '' || capture.lastName === '' || capture.email === '';
    const hasNullValues = capture.firstName === null || capture.lastName === null || capture.email === null;
    
    const needsEnrichment = hasNoEnrichmentStatus || hasFailedStatus || hasNoEnrichedData || hasNAValues || hasEmptyStrings || hasNullValues;
    
    // Debug logging for problematic records
    // Debug logging removed during code cleanup
    
    return needsEnrichment;
  });
  
  stats.skipped = captures.length - needsEnrichment.length;
  
  if (needsEnrichment.length === 0) {
    // All records already processed - debug log removed during cleanup
    return stats;
  }

  // Processing records - debug log removed during cleanup

  // Process in manageable batches
  for (let i = 0; i < needsEnrichment.length; i += ENRICHMENT_CONFIG.BATCH_SIZE) {
    const batch = needsEnrichment.slice(i, i + ENRICHMENT_CONFIG.BATCH_SIZE);
    const batchNum = Math.floor(i / ENRICHMENT_CONFIG.BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(needsEnrichment.length / ENRICHMENT_CONFIG.BATCH_SIZE);
    
    // Processing batch - debug log removed during cleanup
    
    try {
      const batchResults = await processEnrichmentQueue(batch);
      
      // Aggregate batch results
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const capture = batch[j];
        
        if (result.success) {
          stats.enriched++;
          if (result.retried) {
            stats.retried++;
          }
        } else {
          stats.failed++;
          if (result.error) {
            stats.errors.push({
              id: capture.id,
              md5: capture.hashedEmail.substring(0, 8),
              error: result.error,
              retryCount: 0 // This would be updated if we track individual retry counts
            });
          }
        }
      }
      
      console.log(`[${new Date().toISOString()}] ✅ Batch ${batchNum}/${totalBatches} completed: ${batchResults.filter(r => r.success).length} enriched, ${batchResults.filter(r => !r.success).length} failed`);
      
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Error processing batch ${batchNum}:`, error);
      stats.failed += batch.length;
      
      // Add batch error to stats
      batch.forEach(capture => {
        stats.errors.push({
          id: capture.id,
          md5: capture.hashedEmail.substring(0, 8),
          error: error instanceof Error ? error.message : 'Batch processing error',
          retryCount: 0
        });
      });
    }
  }

  // Final summary
  const successRate = stats.total > 0 ? (stats.enriched / (stats.total - stats.skipped) * 100).toFixed(1) : '0';
  console.log(`[${new Date().toISOString()}] 🎯 Batch enrichment completed:`);
  console.log(`[${new Date().toISOString()}]    📊 Total: ${stats.total} | ✅ Enriched: ${stats.enriched} | ❌ Failed: ${stats.failed} | ⏭️  Skipped: ${stats.skipped} | 🔄 Retried: ${stats.retried}`);
  console.log(`[${new Date().toISOString()}]    📈 Success Rate: ${successRate}% | 🚨 Error Rate: ${stats.errors.length > 0 ? (stats.errors.length / (stats.total - stats.skipped) * 100).toFixed(1) : '0'}%`);
  
  // Log error summary if there are errors
  if (stats.errors.length > 0) {
    console.log(`[${new Date().toISOString()}] 🚨 Error Summary (showing first 5):`);
    stats.errors.slice(0, 5).forEach(err => {
      console.log(`[${new Date().toISOString()}]    MD5: ${err.md5}... (ID: ${err.id}) - ${err.error}`);
    });
    if (stats.errors.length > 5) {
      console.log(`[${new Date().toISOString()}]    ... and ${stats.errors.length - 5} more errors`);
    }
  }

  return stats;
}

/**
 * Enriches all pending records for a specific CID
 * @param cid - The Client ID to enrich records for
 */
export async function enrichPendingForCid(cid: string): Promise<{ enriched: number; failed: number; skipped: number }> {
  console.log(`[${new Date().toISOString()}] Starting enrichment for all pending records in CID: ${cid}`);

  // Get all pending enrichment records for this CID
  const pendingRecords = await storage.getEmailCapturesByCid(cid);

  console.log(`[${new Date().toISOString()}] Found ${pendingRecords.length} pending records for CID: ${cid}`);

  if (pendingRecords.length === 0) {
    return { enriched: 0, failed: 0, skipped: 0 };
  }

  return await batchEnrichAndSave(pendingRecords);
}