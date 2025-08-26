import { storage } from '../storage';
import crypto from 'crypto';

export class MailchimpService {
  private apiKey: string;
  private baseUrl: string;
  private listId: string;

  constructor() {
    this.apiKey = process.env.MAILCHIMP_API_KEY || process.env.MAILCHIMP_KEY || "";
    // Extract datacenter from API key (e.g., "us1" from "xxxxx-us1")
    const datacenter = this.apiKey.split('-')[1] || 'us1';
    this.baseUrl = `https://${datacenter}.api.mailchimp.com/3.0`;
    this.listId = process.env.MAILCHIMP_LIST_ID || "";
  }

  async syncContactsByCid(cid?: string): Promise<{ success: boolean; synced: number; errors: number; cidSynced: string[] }> {
    if (!this.apiKey || !this.listId) {
      throw new Error("Mailchimp API key or list ID not configured");
    }

    console.log(`[Mailchimp] Starting sync for CID: ${cid || 'all CIDs'}`);
    
    let totalSynced = 0;
    let totalErrors = 0;
    const cidsSynced: string[] = [];

    try {
      // Get CID accounts to sync
      const cidAccounts = cid ? 
        [await storage.getCidAccount(cid)].filter(Boolean) : 
        await storage.getCidAccounts();

      if (cidAccounts.length === 0) {
        throw new Error(`No CID accounts found${cid ? ` for CID: ${cid}` : ''}`);
      }

      for (const cidAccount of cidAccounts) {
        if (!cidAccount) continue;
        
        // Check account status - skip inactive accounts
        if (cidAccount.status !== 'active') {
          console.log(`[Mailchimp] ❌ Skipping CID ${cidAccount.cid} (${cidAccount.accountName}) - account status is: ${cidAccount.status}`);
          continue;
        }
        
        console.log(`[Mailchimp] ✅ Processing active CID: ${cidAccount.cid} (${cidAccount.accountName})`);
        
        try {
          // Get enriched contacts for this CID that haven't been synced to Mailchimp yet
          // OR have been updated since last Mailchimp sync (delta sync logic)
          const contacts = await storage.getEmailCapturesByCid(cidAccount.cid);
          const enrichedContacts = contacts.filter(c => {
            // Must have email and name data
            const hasRequiredData = c.email && (c.firstName || c.lastName);
            if (!hasRequiredData) return false;
            
            // Include if never synced to Mailchimp OR updated since last sync
            const neverSynced = !c.mailchimpSyncedAt;
            const updatedSinceSync = c.mailchimpSyncedAt && c.updatedAt && c.updatedAt > c.mailchimpSyncedAt;
            
            return neverSynced || updatedSinceSync;
          });
          
          // Log delta sync efficiency
          const totalEnrichedForCid = contacts.filter(c => c.email && (c.firstName || c.lastName)).length;
          const efficiency = totalEnrichedForCid > 0 ? ((totalEnrichedForCid - enrichedContacts.length) / totalEnrichedForCid * 100).toFixed(1) : '0';
          
          console.log(`[Mailchimp] Delta sync for CID ${cidAccount.cid}: ${enrichedContacts.length} new/updated contacts (${efficiency}% reduction from full sync of ${totalEnrichedForCid} total)`);
          
          if (enrichedContacts.length === 0) {
            console.log(`[Mailchimp] ✅ CID ${cidAccount.cid} is fully synced - no new/updated contacts found`);
            continue;
          }

          let cidSyncedCount = 0;
          
          // Process contacts in batches for better performance
          const batchSize = 100;
          for (let i = 0; i < enrichedContacts.length; i += batchSize) {
            const batch = enrichedContacts.slice(i, i + batchSize);
            
            for (const contact of batch) {
              if (!contact.email) continue;
              
              try {
                const success = await this.addContactWithCidTag(
                  contact.email,
                  contact.firstName || '',
                  contact.lastName || '',
                  cidAccount.cid
                );
                
                if (success) {
                  // Update the contact's Mailchimp sync timestamp
                  try {
                    await storage.updateEmailCapture(contact.id, {
                      mailchimpSyncedAt: new Date()
                    });
                  } catch (updateError) {
                    console.error(`[Mailchimp] Warning: Failed to update sync timestamp for contact ${contact.id}:`, updateError);
                  }
                  
                  cidSyncedCount++;
                  totalSynced++;
                } else {
                  totalErrors++;
                }
              } catch (error) {
                console.error(`[Mailchimp] Error syncing contact ${contact.email} for CID ${cidAccount.cid}:`, error);
                totalErrors++;
              }
            }
            
            // Small delay between batches to avoid rate limiting
            if (i + batchSize < enrichedContacts.length) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
          
          console.log(`[Mailchimp] Completed CID ${cidAccount.cid}: ${cidSyncedCount} contacts synced`);
          if (cidSyncedCount > 0) {
            cidsSynced.push(cidAccount.cid);
          }
          
        } catch (error) {
          console.error(`[Mailchimp] Error processing CID ${cidAccount.cid}:`, error);
          totalErrors++;
        }
      }

      return {
        success: true,
        synced: totalSynced,
        errors: totalErrors,
        cidSynced: cidsSynced
      };
      
    } catch (error) {
      console.error("[Mailchimp] Sync error:", error);
      throw error;
    }
  }

  async addContactWithCidTag(email: string, firstName?: string, lastName?: string, cid?: string): Promise<boolean> {
    if (!this.apiKey || !this.listId) {
      throw new Error("Mailchimp API key or list ID not configured");
    }

    try {
      // Create MD5 hash of email for Mailchimp subscriber ID
      const subscriberHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
      
      // Prepare member data with CID tag
      const memberData: any = {
        email_address: email,
        status_if_new: 'subscribed',
        merge_fields: {
          FNAME: firstName || '',
          LNAME: lastName || '',
        },
      };

      // Add CID as a tag if provided
      if (cid) {
        memberData.tags = [cid];
      }

      // Use PUT to create or update contact
      const response = await fetch(`${this.baseUrl}/lists/${this.listId}/members/${subscriberHash}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `apikey ${this.apiKey}`,
        },
        body: JSON.stringify(memberData),
      });

      if (response.ok) {
        console.log(`[Mailchimp] Successfully synced contact: ${email} with tag: ${cid || 'none'}`);
        return true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error(`[Mailchimp] Failed to sync contact ${email}: ${response.status} ${response.statusText}`, errorData);
        return false;
      }
    } catch (error) {
      console.error(`[Mailchimp] Error adding contact ${email}:`, error);
      return false;
    }
  }

  async addContact(email: string, firstName?: string, lastName?: string): Promise<boolean> {
    return this.addContactWithCidTag(email, firstName, lastName);
  }

  async getStatus(): Promise<{ connected: boolean; totalContacts: number; pendingSync: number }> {
    if (!this.apiKey || !this.listId) {
      return { connected: false, totalContacts: 0, pendingSync: 0 };
    }

    try {
      const response = await fetch(`${this.baseUrl}/lists/${this.listId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        return { connected: false, totalContacts: 0, pendingSync: 0 };
      }

      const data = await response.json();
      return {
        connected: true,
        totalContacts: data.stats?.member_count || 0,
        pendingSync: 0,
      };
    } catch (error) {
      console.error("Mailchimp status error:", error);
      return { connected: false, totalContacts: 0, pendingSync: 0 };
    }
  }

  async getTags(): Promise<{ tags: Array<{ id: number; name: string; member_count: number }> }> {
    if (!this.apiKey || !this.listId) {
      throw new Error("Mailchimp API key or list ID not configured");
    }

    try {
      const response = await fetch(`${this.baseUrl}/lists/${this.listId}/segments?type=static&count=1000`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch tags: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return {
        tags: data.segments?.map((segment: any) => ({
          id: segment.id,
          name: segment.name,
          member_count: segment.member_count
        })) || []
      };
    } catch (error) {
      console.error("Mailchimp getTags error:", error);
      throw error;
    }
  }
}

export const mailchimpService = new MailchimpService();
