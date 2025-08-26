import axios from 'axios';

/**
 * Pixel Endpoint Service for capturing MD5 emails and page URLs
 * Integrates with https://spheredsgpixel.com/pixelEndpoint
 */
class PixelEndpointService {
  constructor() {
    this.baseEndpoint = 'https://spheredsgpixel.com/pixelEndpoint';
  }

  /**
   * Fetches md5 and echoes back the pageUrl by matching on CID.
   * @param {Object} params
   * @param {string} params.cid - Customer ID
   * @param {string} params.md5 - MD5 hash
   * @param {string} params.pageUrl - Page URL (will be returned as-is)
   * @param {string|number} params.timestamp - Timestamp
   */
  async captureMd5AndPageUrl({ cid, md5, pageUrl, timestamp }) {
    // Build endpoint URL with required parameters only
    const endpoint = `${this.baseEndpoint}?md5=${encodeURIComponent(md5)}&cid=${encodeURIComponent(cid)}&url=${encodeURIComponent(pageUrl)}&ts=${encodeURIComponent(timestamp)}`;

    try {
      console.log(`[Pixel Endpoint] Calling: ${endpoint}`);
      const response = await axios.get(endpoint, {
        timeout: 10000, // 10 second timeout
        headers: {
          'User-Agent': 'VisitorIQ-Pro/1.0'
        }
      });

      console.log(`[Pixel Endpoint] Response status: ${response.status}`);
      console.log(`[Pixel Endpoint] Response data:`, response.data);

      // Return only md5 and the original pageUrl
      return {
        success: true,
        md5: response.data.md5 || md5,
        pageUrl: pageUrl,
        cid: cid,
        timestamp: timestamp,
        rawResponse: response.data
      };
    } catch (error) {
      console.error('[Pixel Endpoint] API call failed:', error.message);
      if (error.response) {
        console.error('[Pixel Endpoint] Response status:', error.response.status);
        console.error('[Pixel Endpoint] Response data:', error.response.data);
      }
      
      return {
        success: false,
        error: error.message,
        md5: md5, // Return original md5 for safety
        pageUrl: pageUrl,
        cid: cid
      };
    }
  }

  /**
   * Bulk capture multiple MD5/URL combinations for a specific CID
   * @param {string} cid - Customer ID
   * @param {Array} captures - Array of {md5, pageUrl, timestamp} objects
   */
  async bulkCapture(cid, captures) {
    const results = [];
    
    for (const capture of captures) {
      const result = await this.captureMd5AndPageUrl({
        cid,
        ...capture
      });
      results.push(result);
      
      // Small delay to avoid overwhelming the endpoint
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return results;
  }

  /**
   * Test endpoint connectivity with a sample request
   * @param {string} testCid - Test Customer ID
   */
  async testEndpoint(testCid = 'test_cid') {
    const testParams = {
      cid: testCid,
      md5: 'test_md5_hash_1234567890abcdef',
      pageUrl: 'https://example.com/test-page',
      timestamp: Date.now()
    };

    console.log('[Pixel Endpoint] Testing endpoint connectivity...');
    const result = await this.captureMd5AndPageUrl(testParams);
    
    if (result.success) {
      console.log('[Pixel Endpoint] Test successful!');
      console.log('[Pixel Endpoint] MD5:', result.md5);
      console.log('[Pixel Endpoint] Page URL:', result.pageUrl);
    } else {
      console.log('[Pixel Endpoint] Test failed:', result.error);
    }
    
    return result;
  }
}

export default PixelEndpointService;