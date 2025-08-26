import axios from 'axios';

export class WixMD5Service {
  private baseUrl = 'https://www.spheredatasolutionsgroup.com/_functions/pixelEndpoint';

  /**
   * Retrieve MD5 value from Wix endpoint
   * @param md5Value - The MD5 value to send to the endpoint
   * @returns The MD5 value from the response or null if not found
   */
  async fetchMD5FromWix(md5Value: string): Promise<string | null> {
    try {
      // Build the endpoint URL with the md5 query parameter
      const url = `${this.baseUrl}?md5=${encodeURIComponent(md5Value)}`;
      console.log(`Fetching MD5 from Wix endpoint: ${url}`);
      
      const response = await axios.get(url, {
        timeout: 10000, // 10 second timeout
        headers: {
          'User-Agent': 'VisitorIQ-Pro/1.0'
        }
      });

      // Log the full response for debugging
      console.log('Wix endpoint response:', response.data);
      
      // Check various possible response formats
      if (response.data) {
        // Format 1: response.data.received.md5
        if (response.data.received && response.data.received.md5) {
          console.log('MD5 retrieved successfully (format 1):', response.data.received.md5);
          return response.data.received.md5;
        }
        // Format 2: response.data.md5
        if (response.data.md5) {
          console.log('MD5 retrieved successfully (format 2):', response.data.md5);
          return response.data.md5;
        }
        // Format 3: response.data as string (if it's the MD5 value itself)
        if (typeof response.data === 'string' && response.data.length === 32) {
          console.log('MD5 retrieved successfully (format 3):', response.data);
          return response.data;
        }
      }
      
      console.warn('MD5 not found in response. Response data:', response.data);
      console.warn('Response type:', typeof response.data);
      return null;
    } catch (error: any) {
      console.error('Error retrieving MD5:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Batch retrieve multiple MD5 values from Wix endpoint
   * @param md5Values - Array of MD5 values to fetch
   * @returns Array of results with original and retrieved MD5 values
   */
  async batchFetchMD5(md5Values: string[]): Promise<Array<{ original: string; retrieved: string | null }>> {
    const results = [];
    
    for (const md5Value of md5Values) {
      const retrieved = await this.fetchMD5FromWix(md5Value);
      results.push({ original: md5Value, retrieved });
      
      // Small delay to avoid overwhelming the endpoint
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return results;
  }

  /**
   * Test connectivity to the Wix endpoint
   * @returns Connection status and response info
   */
  async testConnection(): Promise<{ connected: boolean; status?: number; error?: string }> {
    try {
      const testMD5 = 'test_md5_value';
      const url = `${this.baseUrl}?md5=${encodeURIComponent(testMD5)}`;
      
      const response = await axios.get(url, {
        timeout: 5000,
        headers: {
          'User-Agent': 'VisitorIQ-Pro/1.0'
        }
      });

      return {
        connected: true,
        status: response.status
      };
    } catch (error: any) {
      return {
        connected: false,
        status: error.response?.status,
        error: error.message
      };
    }
  }
}

export const wixMD5Service = new WixMD5Service();