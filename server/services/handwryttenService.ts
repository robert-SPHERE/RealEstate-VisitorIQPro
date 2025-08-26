import axios from 'axios';
import { storage } from '../storage';

interface HandwryttenRecipient {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

interface HandwryttenPayload {
  recipient: HandwryttenRecipient;
  card_id: string;
  message: string;
  handwriting_id?: string;
  send_date?: string;
}

interface HandwryttenResponse {
  success: boolean;
  message: string;
  noteId?: string;
  error?: string;
}

export class HandwryttenService {
  private apiKey: string;
  private baseUrl = 'https://api.handwrytten.com/v1';
  private testMode: boolean;

  constructor() {
    this.apiKey = process.env.HANDWRYTTEN_API_KEY || '';
    // Environment-based key switching for test vs production
    this.testMode = process.env.NODE_ENV === 'development';
    
    if (!this.apiKey) {
      console.warn('[HandwryttenService] HANDWRYTTEN_API_KEY not configured');
    } else {
      console.log(`[HandwryttenService] Initialized with API key (env: ${process.env.NODE_ENV})`);
    }
  }

  private isConfigured(): boolean {
    return !!this.apiKey;
  }

  private async getCidHandwryttenSettings(cid: string): Promise<{ 
    senderName?: string; 
    messageTemplate?: string; 
    handwritingId?: string; 
    returnAddress?: any; 
    testMode?: boolean;
    enabled?: boolean;
  }> {
    try {
      const cidAccount = await storage.getCidAccount(cid);
      if (cidAccount?.settings && typeof cidAccount.settings === 'object') {
        const settings = cidAccount.settings as any;
        const handwrittenSettings = settings.handwritten || {};
        return {
          senderName: handwrittenSettings.senderName || settings.handwryttenSender,
          messageTemplate: handwrittenSettings.messageTemplate || settings.handwryttenMessage,
          handwritingId: handwrittenSettings.handwritingId || settings.handwritingId,
          returnAddress: handwrittenSettings.returnAddress || settings.handwryttenReturnAddress,
          testMode: handwrittenSettings.testMode || false,
          enabled: handwrittenSettings.enabled !== false // Default to enabled unless explicitly disabled
        };
      }
    } catch (error) {
      console.log(`[HandwryttenService] Could not get CID settings for ${cid}:`, error);
    }
    return { enabled: true }; // Default enabled
  }

  // Helper method to build return address for API payload
  private buildReturnAddress(returnAddressConfig: any): any {
    if (!returnAddressConfig) return undefined;
    
    const { name, address1, address2, city, state, zip, country } = returnAddressConfig;
    
    // Validate required fields for return address
    if (!name || !address1 || !city || !state || !zip) {
      return undefined; // Invalid/incomplete address
    }
    
    return {
      name,
      address1,
      address2: address2 || undefined,
      city,
      state,
      zip,
      country: country || 'US'
    };
  }

  // Enhanced retry mechanism with exponential backoff for rate limiting
  private async sendWithRetry(url: string, payload: any, headers: any, maxRetries = 3): Promise<any> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.post(url, payload, {
          headers,
          timeout: 30000
        });
        return response.data;
      } catch (error: any) {
        const status = error.response?.status;
        
        // Don't retry on client errors (4xx except 429)
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw error;
        }
        
        // Retry on rate limiting (429) or server errors (5xx)
        if (attempt < maxRetries && (status === 429 || (status && status >= 500))) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
          console.log(`[HandwryttenService] Attempt ${attempt} failed with ${status}, retrying in ${backoffMs}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }
        
        throw error;
      }
    }
  }

  async sendNote(record: any, cardId: string = '1', customMessage?: string, customHandwritingId?: string): Promise<HandwryttenResponse> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: 'Handwrytten API key not configured',
        error: 'HANDWRYTTEN_API_KEY environment variable not set'
      };
    }

    // Check if record has required address fields
    const requiredFields = ['firstName', 'lastName', 'address', 'city', 'state', 'zip'];
    const missingFields = requiredFields.filter(field => !record[field]);
    
    if (missingFields.length > 0) {
      return {
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`,
        error: 'INCOMPLETE_ADDRESS'
      };
    }

    // Get CID-specific settings
    const cidSettings = await this.getCidHandwryttenSettings(record.cid);
    
    // Build final message with personalization and signature
    const defaultSender = cidSettings.senderName || "Robbie at Sphere DSG";
    const defaultTemplate = `Hi {firstName},\n\nThank you for your interest in our services! We appreciate you visiting our website and hope to connect with you soon.`;
    
    let messageTemplate = customMessage || cidSettings.messageTemplate || defaultTemplate;
    
    // Personalize the message template with contact data
    let finalMessage = messageTemplate
      .replace(/{firstName}/g, record.firstName || 'there')
      .replace(/{lastName}/g, record.lastName || '')
      .replace(/{fullName}/g, `${record.firstName || ''} ${record.lastName || ''}`.trim() || 'there')
      .replace(/{city}/g, record.city || '')
      .replace(/{state}/g, record.state || '');
    
    // Add signature if not already present
    if (finalMessage && !finalMessage.includes('–') && !finalMessage.includes('Sincerely') && !finalMessage.includes('Best regards')) {
      finalMessage += `\n\n– ${defaultSender}`;
    }
    
    // Build return address from settings
    const returnAddress = this.buildReturnAddress(cidSettings.returnAddress);
    
    const payload: HandwryttenPayload = {
      recipient: {
        name: `${record.firstName} ${record.lastName}`.trim(),
        address1: record.address,
        address2: record.address2 || undefined,
        city: record.city,
        state: record.state,
        zip: record.zip,
        country: 'US'
      },
      card_id: cardId,
      message: finalMessage,
      handwriting_id: customHandwritingId || cidSettings.handwritingId || undefined,
      return_address: returnAddress
    };

    // Create idempotency key to prevent duplicates
    const crypto = await import('crypto');
    const idempotencyKey = crypto.createHash('md5')
      .update(`${record.cid}-${record.id}-${new Date().toDateString()}`)
      .digest('hex');

    try {
      console.log(`[HandwryttenService] Sending note to ${payload.recipient.name} (env: ${process.env.NODE_ENV})`);
      
      const response = await this.sendWithRetry(`${this.baseUrl}/orders/singleStepOrder`, payload, {
        'X-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      });

      console.log(`[HandwryttenService] Note sent successfully. Response:`, response);

      return {
        success: true,
        message: 'Note sent successfully',
        noteId: response.order_id || response.id
      };
    } catch (error: any) {
      console.error('[HandwryttenService] Error sending note:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to send handwritten note',
        error: error.response?.status || 'UNKNOWN_ERROR'
      };
    }
  }

  async syncEnrichedContacts(cid?: string, customMessage?: string, customHandwritingId?: string): Promise<{ success: boolean; message: string; sent: number; errors: number }> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: 'Handwrytten API key not configured',
        sent: 0,
        errors: 0
      };
    }

    try {
      console.log(`[HandwryttenService] Starting sync for CID: ${cid || 'all'}`);
      
      // Check account status if CID is specified - skip inactive accounts
      if (cid) {
        const cidAccount = await storage.getCidAccount(cid);
        if (!cidAccount || cidAccount.status !== 'active') {
          console.log(`[HandwryttenService] ❌ Skipping CID ${cid} - account is ${cidAccount?.status || 'not found'}`);
          return {
            success: false,
            message: `Account ${cid} is ${cidAccount?.status || 'not found'} - sync aborted`,
            sent: 0,
            errors: 0
          };
        }
        console.log(`[HandwryttenService] ✅ Account ${cid} (${cidAccount.accountName}) is active - proceeding with sync`);
      }
      
      // Get enriched contacts with complete address information for this CID
      const allContacts = cid ? await storage.getEmailCapturesByCid(cid) : await storage.getEmailCaptures();
      
      // Filter contacts that have complete address information and are enriched
      // AND apply delta sync logic - only process contacts that haven't been synced to Handwrytten yet
      // OR have been updated since last Handwrytten sync
      const addressCompleteContacts = allContacts.filter((contact: any) => {
        // Must have complete address and enrichment data
        const hasCompleteData = contact.enrichmentStatus === 'completed' && 
          contact.firstName && 
          contact.lastName && 
          contact.address && 
          contact.city && 
          contact.state && 
          contact.zip;
        
        if (!hasCompleteData) return false;
        
        // Delta sync logic: Include if never synced to Handwrytten OR updated since last sync
        const neverSynced = !contact.handwryttenSyncedAt;
        const updatedSinceSync = contact.handwryttenSyncedAt && contact.updatedAt && contact.updatedAt > contact.handwryttenSyncedAt;
        
        return neverSynced || updatedSinceSync;
      });

      // Log delta sync efficiency
      const totalEnrichedForCid = allContacts.filter((contact: any) => 
        contact.enrichmentStatus === 'completed' && 
        contact.firstName && 
        contact.lastName && 
        contact.address && 
        contact.city && 
        contact.state && 
        contact.zip
      ).length;
      
      const efficiency = totalEnrichedForCid > 0 ? ((totalEnrichedForCid - addressCompleteContacts.length) / totalEnrichedForCid * 100).toFixed(1) : '0';
      
      console.log(`[HandwryttenService] Delta sync for CID ${cid || 'all'}: ${addressCompleteContacts.length} new/updated contacts with complete addresses (${efficiency}% reduction from full sync of ${totalEnrichedForCid} total)`);

      if (addressCompleteContacts.length === 0) {
        console.log(`[HandwryttenService] ✅ CID ${cid || 'all'} is fully synced - no new/updated contacts with complete addresses found`);
        return {
          success: true,
          message: 'No new/updated contacts found to sync',
          sent: 0,
          errors: 0
        };
      }

      let sent = 0;
      let errors = 0;

      // Process contacts in batches to avoid rate limiting
      const batchSize = 5;
      for (let i = 0; i < addressCompleteContacts.length; i += batchSize) {
        const batch = addressCompleteContacts.slice(i, i + batchSize);
        
        for (const contact of batch) {
          try {
            // Get CID-specific settings for this contact
            const cidSettings = await this.getCidHandwryttenSettings(contact.cid);
            
            // Use provided custom message/handwriting, then CID-specific, then default
            const messageTemplate = customMessage || cidSettings.messageTemplate;
            const handwritingId = customHandwritingId || cidSettings.handwritingId;
            
            // Personalize the message template
            const defaultSender = cidSettings.senderName || "Robbie at Sphere DSG";
            const defaultTemplate = `Hi {firstName},\n\nThank you for your interest in our services! We appreciate you visiting our website and hope to connect with you soon.`;
            
            let personalizedMessage = (messageTemplate || defaultTemplate)
              .replace(/{firstName}/g, contact.firstName || 'there')
              .replace(/{lastName}/g, contact.lastName || '')
              .replace(/{fullName}/g, `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'there')
              .replace(/{city}/g, contact.city || '')
              .replace(/{state}/g, contact.state || '');
            
            // Add signature if not already present
            if (personalizedMessage && !personalizedMessage.includes('–') && !personalizedMessage.includes('Sincerely') && !personalizedMessage.includes('Best regards')) {
              personalizedMessage += `\n\n– ${defaultSender}`;
            }
            
            console.log(`[HandwryttenService] Sending to ${contact.firstName} ${contact.lastName} (CID: ${contact.cid})`);
            console.log(`[HandwryttenService] Using CID-specific template: ${!!cidSettings.messageTemplate}, handwriting: ${!!cidSettings.handwritingId}`);
            
            const result = await this.sendNote(contact, '1', personalizedMessage, handwritingId);
            
            if (result.success) {
              // Update the contact's Handwrytten sync timestamp
              try {
                await storage.updateEmailCapture(contact.id, {
                  handwryttenSyncedAt: new Date()
                });
              } catch (updateError) {
                console.error(`[HandwryttenService] Warning: Failed to update sync timestamp for contact ${contact.id}:`, updateError);
              }
              
              sent++;
              console.log(`[HandwryttenService] Sent note to ${contact.firstName} ${contact.lastName} (${contact.cid})`);
            } else {
              errors++;
              console.error(`[HandwryttenService] Failed to send note to ${contact.firstName} ${contact.lastName}: ${result.message}`);
            }
            
            // Small delay between requests - reduced since we have exponential backoff
            await new Promise(resolve => setTimeout(resolve, 500));
            
          } catch (error) {
            errors++;
            console.error(`[HandwryttenService] Error processing contact ${contact.id}:`, error);
          }
        }
        
        // Longer delay between batches
        if (i + batchSize < addressCompleteContacts.length) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      const message = `Handwrytten sync complete: ${sent} notes sent, ${errors} errors`;
      console.log(`[HandwryttenService] ${message}`);

      return {
        success: true,
        message,
        sent,
        errors
      };
      
    } catch (error: any) {
      console.error('[HandwryttenService] Sync failed:', error);
      return {
        success: false,
        message: `Sync failed: ${error.message}`,
        sent: 0,
        errors: 0
      };
    }
  }

  async getStatus(): Promise<{ connected: boolean; configured: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return {
        connected: false,
        configured: false,
        error: 'API key not configured'
      };
    }

    try {
      console.log(`[HandwryttenService] Testing API connection (env: ${process.env.NODE_ENV})`);
      
      // Test API connection by fetching available fonts/handwriting styles
      // This is a lightweight endpoint that confirms API access
      const response = await axios.get(`${this.baseUrl}/fonts/list`, {
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      console.log(`[HandwryttenService] API connection successful - ${response.data?.length || 0} handwriting styles available`);

      return {
        connected: true,
        configured: true
      };
    } catch (error: any) {
      console.error('[HandwryttenService] API connection failed:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      
      return {
        connected: false,
        configured: true,
        error: error.response?.data?.message || error.message
      };
    }
  }
}

export const handwryttenService = new HandwryttenService();