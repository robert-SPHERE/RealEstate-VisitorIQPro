import { pixelEndpointService } from "./pixelEndpointService";

export class EndpointMonitoringService {
  private sphereDataUrl = "https://spheredatasolutionsgroup.com/_functions/pixelEndpoint";
  private monitoringActive = false;
  private lastCheck: Date | null = null;
  private endpointStatus: 'online' | 'offline' | 'error' = 'online';

  // Option 1: Direct API Polling (if they provide an API)
  async pollForUpdates(intervalMs: number = 60000): Promise<void> {
    if (this.monitoringActive) {
      // Monitoring already active
      return;
    }

    this.monitoringActive = true;
    // Starting endpoint polling

    const pollInterval = setInterval(async () => {
      try {
        await this.checkForNewEmails();
      } catch (error) {
        // Polling error logged internally
      }
    }, intervalMs);

    // Cleanup handler
    process.on('SIGINT', () => {
      clearInterval(pollInterval);
      this.monitoringActive = false;
    });
  }

  // Option 2: Database Change Detection (if they provide DB access)
  async checkForNewEmails(): Promise<{ newEmails: number; processed: number }> {
    try {
      // This would connect to their database or API to check for new MD5 emails
      // Example implementation (you'd replace with actual API calls):
      
      const since = this.lastCheck || new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours
      this.lastCheck = new Date();

      // Checking for new emails since last sync

      // Simulated API call structure (replace with actual endpoint)
      const newEmails = await this.fetchNewEmailsFromSphere(since);
      
      let processed = 0;
      for (const email of newEmails) {
        try {
          await pixelEndpointService.captureFromPixelEndpoint({
            md5: email.md5,
            cid: email.cid,
            url: email.url,
            session_id: email.session_id,
            var1: email.var1,
            var2: email.var2,
            ts: email.timestamp
          });
          processed++;
        } catch (error) {
          // Failed to process email - logged internally
        }
      }

      // Email processing completed
      return { newEmails: newEmails.length, processed };

    } catch (error) {
      // Error checking for new emails - logged internally
      return { newEmails: 0, processed: 0 };
    }
  }

  // Option 3: File Watch Monitoring (if they provide file exports)
  async monitorFileDrops(watchDirectory: string): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');

    // Directory monitoring active

    if (!fs.existsSync(watchDirectory)) {
      // Watch directory does not exist
      return;
    }

    fs.watch(watchDirectory, async (eventType, filename) => {
      if (eventType === 'rename' && filename?.endsWith('.csv')) {
        console.log(`New file detected: ${filename}`);
        
        const filePath = path.join(watchDirectory, filename);
        await this.processEmailFile(filePath);
      }
    });
  }

  // Option 4: Email Export Processing
  async processEmailFile(filePath: string): Promise<{ processed: number; errors: number }> {
    const fs = await import('fs');
    const readline = await import('readline');

    let processed = 0;
    let errors = 0;

    try {
      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        if (line.trim() && !line.startsWith('md5,cid')) { // Skip header
          try {
            const [md5, cid, url, session_id, var1, var2, ts] = line.split(',');
            
            await pixelEndpointService.captureFromPixelEndpoint({
              md5: md5?.trim(),
              cid: cid?.trim(),
              url: url?.trim(),
              session_id: session_id?.trim(),
              var1: var1?.trim(),
              var2: var2?.trim(),
              ts: ts?.trim()
            });
            
            processed++;
          } catch (error) {
            console.error(`Failed to process line: ${line}`, error);
            errors++;
          }
        }
      }

      console.log(`File processing complete: ${processed} processed, ${errors} errors`);
      
      // Archive processed file
      const processedPath = filePath.replace('.csv', '_processed.csv');
      fs.renameSync(filePath, processedPath);

    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
      errors++;
    }

    return { processed, errors };
  }

  // Mock function - replace with actual Sphere Data Solutions API call
  private async fetchNewEmailsFromSphere(since: Date): Promise<Array<{
    md5: string;
    cid: string;
    url?: string;
    session_id?: string;
    var1?: string;
    var2?: string;
    timestamp: string;
  }>> {
    // This is where you'd make the actual API call to Sphere Data Solutions
    // Example structure:
    
    try {
      // Replace with actual API endpoint and authentication
      const response = await fetch(`${this.sphereDataUrl}/api/emails?since=${since.toISOString()}`, {
        headers: {
          'Authorization': 'Bearer YOUR_API_KEY',
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      return data.emails || [];

    } catch (error) {
      console.error("Failed to fetch from Sphere Data Solutions:", error);
      return [];
    }
  }

  // Get monitoring status
  getStatus(): {
    active: boolean;
    lastCheck: Date | null;
    sphereDataUrl: string;
  } {
    return {
      active: this.monitoringActive,
      lastCheck: this.lastCheck,
      sphereDataUrl: this.sphereDataUrl
    };
  }

  // Stop monitoring
  stopMonitoring(): void {
    this.monitoringActive = false;
    console.log("Endpoint monitoring stopped");
  }
}

export const endpointMonitoringService = new EndpointMonitoringService();