import { storage } from "../storage";
import { enrichAndSave } from "./enrichmentService";

export class PixelEndpointService {
  private baseUrl = "https://spheredatasolutionsgroup.com/_functions/pixelEndpoint";

  async captureFromPixelEndpoint(params: {
    md5?: string;
    cid?: string;
    url?: string;
    session_id?: string;
    var1?: string;
    var2?: string;
    ts?: string;
  }): Promise<any> {
    try {
      const { md5, cid, url, session_id, var1, var2, ts } = params;

      // If MD5 hash is provided, process it
      if (md5 && md5.length === 32) {
        console.log(`Processing MD5 hash from pixel endpoint: ${md5}`);

        // Ensure CID is provided for separation
        if (!cid) {
          throw new Error("CID is required for pixel endpoint captures");
        }

        // Auto-create CID account if it doesn't exist
        await storage.upsertCidAccount({
          cid,
          accountName: `Account ${cid}`,
          description: `Auto-created from pixel endpoint`,
          status: "active"
        });

        // Create email capture record with CID and all pixel endpoint fields
        const capture = await storage.createEmailCapture({
          originalEmail: `hashed_${md5}`, // Placeholder since we only have hash
          hashedEmail: md5,
          cid, // Separate by CID
          userId: "pixel_endpoint", // System user for pixel captures
          source: "pixel_endpoint",
          url, // Store URL directly in database field
          sessionId: session_id, // Store session_id directly in database field
          var1, // Store var1 directly in database field
          var2, // Store var2 directly in database field
          ts, // Store timestamp directly in database field
          metadata: {
            pixel_endpoint_capture: true,
            captured_at: new Date().toISOString()
          }
        });

        // Start enrichment process with the MD5 hash
        try {
          const enrichmentData = await audienceAcuityService.enrichEmail(md5);
          await storage.updateEmailCaptureEnrichment(capture.id, enrichmentData);
          
          // Update identity metrics
          const currentMetrics = await storage.getIdentityMetrics();
          const updates = {
            hashedEmails: (currentMetrics?.hashedEmails || 0) + 1,
            contactEmail: enrichmentData?.contact_email ? (currentMetrics?.contactEmail || 0) + 1 : (currentMetrics?.contactEmail || 0),
            geographicData: enrichmentData?.address ? (currentMetrics?.geographicData || 0) + 1 : (currentMetrics?.geographicData || 0),
            age: enrichmentData?.age ? (currentMetrics?.age || 0) + 1 : (currentMetrics?.age || 0),
            phoneNumber: enrichmentData?.phone ? (currentMetrics?.phoneNumber || 0) + 1 : (currentMetrics?.phoneNumber || 0),
            householdIncome: enrichmentData?.income ? (currentMetrics?.householdIncome || 0) + 1 : (currentMetrics?.householdIncome || 0),
          };
          await storage.updateIdentityMetrics(updates);
          
          console.log(`Successfully enriched pixel endpoint MD5: ${md5}`);
          
        } catch (enrichmentError) {
          console.error("Pixel endpoint enrichment failed:", enrichmentError);
          // Still update metrics for the captured hash
          const currentMetrics = await storage.getIdentityMetrics();
          await storage.updateIdentityMetrics({
            hashedEmails: (currentMetrics?.hashedEmails || 0) + 1,
          });
        }

        return {
          success: true,
          captureId: capture.id,
          hashedEmail: md5,
          processed: true
        };
      }

      // If no MD5 provided, still log the pixel event
      console.log("Pixel endpoint called without MD5 hash:", params);
      return {
        success: true,
        processed: false,
        message: "Pixel event logged but no MD5 hash provided"
      };

    } catch (error) {
      console.error("Pixel endpoint processing error:", error);
      throw error;
    }
  }

  async monitorPixelEndpoint(intervalMs: number = 30000): Promise<void> {
    console.log(`Starting pixel endpoint monitoring every ${intervalMs}ms`);
    
    setInterval(async () => {
      try {
        console.log("Pixel endpoint monitoring active...");
      } catch (error) {
        console.error("Pixel endpoint monitoring error:", error);
      }
    }, intervalMs);
  }

  // Real-time webhook handler for Sphere Data Solutions
  async processWebhookData(webhookData: {
    md5_emails: Array<{
      md5: string;
      cid: string;
      timestamp: string;
      metadata?: any;
    }>;
  }): Promise<{ processed: number; errors: number }> {
    let processed = 0;
    let errors = 0;

    for (const emailData of webhookData.md5_emails) {
      try {
        await this.captureFromPixelEndpoint({
          md5: emailData.md5,
          cid: emailData.cid,
          ts: emailData.timestamp,
          ...emailData.metadata
        });
        processed++;
      } catch (error) {
        console.error(`Failed to process webhook email ${emailData.md5}:`, error);
        errors++;
      }
    }

    return { processed, errors };
  }
}

export const pixelEndpointService = new PixelEndpointService();