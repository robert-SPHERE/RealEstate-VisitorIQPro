// Audience Acuity OAuth 2.0 configuration
const AA_CLIENT_ID = process.env.AUDIENCE_ACUITY_KEY_ID;
const AA_CLIENT_SECRET = process.env.AUDIENCE_ACUITY_API_KEY;
const AA_ORIGIN = process.env.AA_ORIGIN || 'https://api.audienceacuity.com';
const TEMPLATE_ID = 210723778;

if (!AA_CLIENT_ID || !AA_CLIENT_SECRET) {
  console.error('Missing Audience Acuity credentials: AUDIENCE_ACUITY_KEY_ID and AUDIENCE_ACUITY_API_KEY required');
} else {
  console.log(`[${new Date().toISOString()}] Audience Acuity configured with Client ID: ${AA_CLIENT_ID.substring(0, 4)}***`);
}

// Token cache to avoid unnecessary OAuth requests
let tokenCache: {
  access_token: string;
  expires_at: number;
} | null = null;

// Track authentication method being used
let authMethod: 'oauth' | 'bearer' | null = null;

/**
 * Manually set OAuth token (for cases where OAuth works externally but not from this environment)
 */
export function setManualOAuthToken(accessToken: string, expiresIn: number = 3600): void {
  tokenCache = {
    access_token: accessToken,
    expires_at: Date.now() + (expiresIn * 1000)
  };
  authMethod = 'oauth';
  console.log(`[${new Date().toISOString()}] Manual OAuth token set (expires in ${Math.round(expiresIn / 60)} minutes)`);
}

/**
 * Clear authentication cache and reset method
 */
export function clearAuthCache(): void {
  tokenCache = null;
  authMethod = null;
  console.log(`[${new Date().toISOString()}] Authentication cache cleared`);
}

/**
 * Force OAuth token refresh - for manual sync button and scheduled sync
 */
export async function ensureValidOAuthToken(): Promise<boolean> {
  console.log(`[${new Date().toISOString()}] Ensuring valid OAuth token for sync operation...`);
  
  // Check if current token is still valid (with 10 min buffer for sync operations)
  if (authMethod === 'oauth' && tokenCache && tokenCache.expires_at > Date.now() + 600000) {
    console.log(`[${new Date().toISOString()}] Current OAuth token is valid (expires in ${Math.round((tokenCache.expires_at - Date.now()) / 1000 / 60)} minutes)`);
    return true;
  }
  
  // Force refresh OAuth token
  const refreshed = await refreshOAuthToken(5); // More retries for sync operations
  if (refreshed) {
    console.log(`[${new Date().toISOString()}] OAuth token ready for sync operations`);
    return true;
  }
  
  console.log(`[${new Date().toISOString()}] OAuth token refresh failed - sync will use fallback authentication`);
  return false;
}

/**
 * Generate custom Bearer token (fallback method)
 * Uses dynamic timestamp and MD5 hash for security
 */
async function generateCustomBearerToken(debug = false): Promise<string> {
  const now = Date.now().toString(36);
  const crypto = await import('crypto');
  const stringToHash = `${now}${AA_CLIENT_SECRET}`;
  const hash = crypto.createHash('md5').update(stringToHash).digest('hex');
  const authHeader = `Bearer ${AA_CLIENT_ID}${now}${hash}`;
  
  if (debug) {
    // Custom Bearer token authentication debug info logged internally
  }
  
  return authHeader;
}

/**
 * Automated OAuth token refresh - tries to get fresh token with retries
 */
async function refreshOAuthToken(retries = 3): Promise<boolean> {
  if (!AA_CLIENT_ID || !AA_CLIENT_SECRET) {
    console.log(`[${new Date().toISOString()}] Missing OAuth credentials - cannot refresh token`);
    return false;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[${new Date().toISOString()}] OAuth token refresh attempt ${attempt}/${retries}...`);
      
      const oauthUrl = `${AA_ORIGIN}/v2/oauth?client_id=${AA_CLIENT_SECRET}&client_secret=${AA_CLIENT_ID}`;
      
      const response = await fetch(oauthUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(15000) // 15 second timeout
      });

      if (response.ok) {
        const tokenData = await response.json();
        
        if (tokenData.access_token) {
          const expiresIn = tokenData.expires_in || 3600;
          tokenCache = {
            access_token: tokenData.access_token,
            expires_at: Date.now() + (expiresIn * 1000)
          };
          authMethod = 'oauth';
          
          console.log(`[${new Date().toISOString()}] ✅ OAuth token refreshed successfully (expires in ${Math.round(expiresIn / 60)} minutes)`);
          return true;
        }
      } else {
        const errorText = await response.text();
        console.log(`[${new Date().toISOString()}] OAuth refresh failed: ${response.status} - ${errorText}`);
      }
    } catch (error: any) {
      console.log(`[${new Date().toISOString()}] OAuth refresh attempt ${attempt} failed: ${error.message}`);
      
      // Wait before retry (except on last attempt)
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  
  console.log(`[${new Date().toISOString()}] ❌ OAuth token refresh failed after ${retries} attempts`);
  return false;
}

/**
 * Get authentication header with automated OAuth token refresh
 * Caches successful method and tokens to avoid unnecessary requests
 */
async function getAuthHeader(debug = false): Promise<string> {
  // Check if we have a valid cached OAuth token (with 5 min buffer)
  if (authMethod === 'oauth' && tokenCache && tokenCache.expires_at > Date.now() + 300000) {
    if (debug) {
      console.log(`[${new Date().toISOString()}] Using cached OAuth token (expires in ${Math.round((tokenCache.expires_at - Date.now()) / 1000 / 60)} minutes)`);
    }
    return `Bearer ${tokenCache.access_token}`;
  }
  
  // If we have an expired or soon-to-expire OAuth token, try to refresh it
  if (authMethod !== 'bearer' && (!tokenCache || tokenCache.expires_at <= Date.now() + 300000)) {
    const refreshed = await refreshOAuthToken();
    if (refreshed && tokenCache) {
      if (debug) {
        console.log(`[${new Date().toISOString()}] Using refreshed OAuth token`);
      }
      return `Bearer ${tokenCache.access_token}`;
    }
  }
  
  // If we've determined that OAuth doesn't work, use custom Bearer token
  if (authMethod === 'bearer') {
    return await generateCustomBearerToken(debug);
  }

  // Last resort: fall back to custom Bearer token method
  console.log(`[${new Date().toISOString()}] OAuth unavailable, falling back to custom Bearer token`);
  authMethod = 'bearer';
  return await generateCustomBearerToken(debug);
}

/**
 * Direct API call to Audience Acuity for hash-based identity lookup using OAuth 2.0
 * @param {string} md5Hash - The MD5 hash to look up
 * @returns {Promise<any>} - API response
 */
async function callAudienceAcuityAPI(md5Hash: string): Promise<any> {
  const endpoints = [
    `/v2/identities/byMd5?md5=${md5Hash}&template=${TEMPLATE_ID}`,
    `/v2/identities/byHash?hash=${md5Hash}&template=${TEMPLATE_ID}`,
    `/v2/identities/byEmail?email=${md5Hash}&template=${TEMPLATE_ID}`,
  ];

  // Get authentication header (OAuth or custom Bearer token)
  const authHeader = await getAuthHeader(true); // Enable debug for troubleshooting

  for (const endpoint of endpoints) {
    try {
      const url = `${AA_ORIGIN}${endpoint}`;
      console.log(`[${new Date().toISOString()}] Trying Audience Acuity endpoint: ${endpoint} (${authMethod} auth)`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(25000) // 25 second timeout
      });

      console.log(`[${new Date().toISOString()}] Audience Acuity response: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`[${new Date().toISOString()}] Successfully got data from endpoint: ${endpoint}`);
        return data;
      } else if (response.status === 404) {
        console.log(`[${new Date().toISOString()}] 404 from endpoint: ${endpoint} - trying next endpoint`);
        continue; // Try next endpoint
      } else {
        const errorText = await response.text();
        console.error(`[${new Date().toISOString()}] API error from ${endpoint}: ${response.status} - ${errorText}`);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
    } catch (error: any) {
      if (error.name === 'TimeoutError') {
        console.error(`[${new Date().toISOString()}] Timeout for endpoint: ${endpoint}`);
        throw new Error(`API call timeout for ${endpoint}`);
      }
      console.error(`[${new Date().toISOString()}] Error calling ${endpoint}:`, error.message);
      
      // If this is the last endpoint, throw the error
      if (endpoint === endpoints[endpoints.length - 1]) {
        throw error;
      }
    }
  }
  
  throw new Error('All Audience Acuity endpoints failed or returned 404');
}

// Add/extend this model
export interface AudienceAcuityEmail {
  email: string;
  md5?: string;
  sha1?: string;
  sha256?: string;
  optIn?: boolean;
  qualityLevel?: number; // 0..4
  ip?: string;
  rankOrder?: number;    // lower is better
  registerDate?: string; // e.g., "2018-01-10"
  updateDate?: string;   // e.g., "2025-06-23"
  url?: string;
}

export interface AudienceAcuityEnrichment {
  firstName?: string;
  lastName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  gender?: string;
  birthDate?: string;
  emails?: AudienceAcuityEmail[];
  // 👇 we will compute these
  bestEmail?: string;
  bestEmailQuality?: number;
  ips?: Array<string>;
  data?: {
    householdIncome?: string;
    homeOwnership?: string;
    lengthOfResidence?: string;
    age?: number;
    maritalStatus?: string;
    householdPersons?: number;
    householdChildren?: number;
    mortgageLoanType?: string;
    mortgageAmount?: string;
    mortgageAge?: string;
    homePrice?: string;
    homeValue?: string;
  };
}

/**
 * Enriches a visitor record by MD5 via Audience Acuity.
 * @param {string} md5 - The MD5 hash of the email
 * @returns {Promise<AudienceAcuityEnrichment|null>}
 */
export async function enrichWithAudienceAcuity(md5: string): Promise<AudienceAcuityEnrichment | null> {
  try {
    console.log(`[${new Date().toISOString()}] Starting enrichment for MD5: ${md5.substring(0, 8)}...`);
    
    if (!AA_CLIENT_ID || !AA_CLIENT_SECRET) {
      throw new Error('Missing Audience Acuity credentials');
    }
    
    // Call the Audience Acuity API directly
    const response = await callAudienceAcuityAPI(md5);
    
    if (response && Array.isArray(response) && response.length > 0) {
      console.log(`[${new Date().toISOString()}] Enrichment successful for MD5: ${md5.substring(0, 8)}... - Found ${response.length} results`);
      const enrichment = response[0];
      
      // Attach computed bestEmail fields
      if (enrichment && enrichment.emails?.length) {
        const best = selectBestEmail(enrichment.emails);
        if (best) {
          enrichment.bestEmail = best.email;
          enrichment.bestEmailQuality = best.quality;
        }
      }
      return enrichment;
    } else if (response && typeof response === 'object' && !Array.isArray(response)) {
      console.log(`[${new Date().toISOString()}] Enrichment successful for MD5: ${md5.substring(0, 8)}... - Found object response`);
      
      let enrichment;
      // Check if response has identities array (new API format)
      if (response.identities && Array.isArray(response.identities) && response.identities.length > 0) {
        console.log(`[${new Date().toISOString()}] Extracting first identity from identities array for MD5: ${md5.substring(0, 8)}...`);
        enrichment = response.identities[0];
      } else {
        // Otherwise use the response as-is (legacy format)
        enrichment = response;
      }
      
      // Attach computed bestEmail fields
      if (enrichment && enrichment.emails?.length) {
        const best = selectBestEmail(enrichment.emails);
        if (best) {
          enrichment.bestEmail = best.email;
          enrichment.bestEmailQuality = best.quality;
        }
      }
      return enrichment;
    }
    
    console.log(`[${new Date().toISOString()}] No enrichment data found for MD5: ${md5.substring(0, 8)}...`);
    return null;
  } catch (err: any) {
    if (err.message?.includes('404') || err.message?.includes('All Audience Acuity endpoints failed')) {
      console.log(`[${new Date().toISOString()}] MD5 not found in Audience Acuity: ${md5.substring(0, 8)}...`);
      return null;
    }
    
    console.error(`[${new Date().toISOString()}] Audience Acuity API error for MD5 ${md5.substring(0, 8)}...:`, {
      message: err.message,
      stack: err.stack?.substring(0, 500),
      name: err.name
    });
    return null;
  }
}

/**
 * Maps Audience Acuity enrichment data to database fields
 * @param {AudienceAcuityEnrichment} enrichment 
 * @returns {Object} Database update fields
 */
/**
 * Convert income text ranges to numeric values for database storage
 */
function parseIncomeRange(income: string): number | null {
  if (!income || typeof income !== 'string') return null;
  
  // Extract numbers from ranges like "$200K to $249K"
  const match = income.match(/\$?(\d+)K?\s*to\s*\$?(\d+)K?/i);
  if (match) {
    const low = parseInt(match[1]) * (match[1].includes('K') ? 1000 : 1);
    const high = parseInt(match[2]) * (match[2].includes('K') ? 1000 : 1);
    return Math.round((low + high) / 2); // Return midpoint
  }
  
  // Handle single values like "$100K" or "100000"
  const singleMatch = income.match(/\$?(\d+)K?/i);
  if (singleMatch) {
    return parseInt(singleMatch[1]) * (income.includes('K') ? 1000 : 1);
  }
  
  return null;
}

function safeTime(dateStr?: string | null): number {
  const t = dateStr ? Date.parse(dateStr) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * Select the best email from Audience Acuity's emails list.
 * Priority:
 * 1) lowest qualityLevel (0-4 scale, 0 = best, 4 = worst)
 * 2) lowest rankOrder (1 better than 2)
 * 3) most recent updateDate
 * 4) earliest registerDate (stable tie-breaker)
 * 5) optIn = true preferred
 */
export function selectBestEmail(emails: AudienceAcuityEmail[] | undefined | null): {
  email: string | null;
  quality: number | null;
  rankOrder: number | null;
} | null {
  if (!emails || emails.length === 0) return null;

  const worstQuality = Number.POSITIVE_INFINITY; // sentinel beyond 4
  const worstRank = Number.POSITIVE_INFINITY;

  const sorted = emails.slice().sort((a, b) => {
    // 1) Quality Level (lower = better; 0–4 scale)
    const qa = a.qualityLevel ?? worstQuality;
    const qb = b.qualityLevel ?? worstQuality;
    if (qa !== qb) return qa - qb;

    // 2) Rank Order (lower = better)
    const ra = a.rankOrder ?? worstRank;
    const rb = b.rankOrder ?? worstRank;
    if (ra !== rb) return ra - rb;

    // 3) Update Date (newer = better)
    const ua = safeTime(a.updateDate);
    const ub = safeTime(b.updateDate);
    if (ua !== ub) return ub - ua;

    // 4) Registration Date (earlier = better)
    const rga = safeTime(a.registerDate);
    const rgb = safeTime(b.registerDate);
    if (rga !== rgb) return rga - rgb;

    // 5) Opt-in (true preferred)
    const oa = a.optIn ? 1 : 0;
    const ob = b.optIn ? 1 : 0;
    return ob - oa;
  });

  const top = sorted[0];
  return {
    email: top?.email ?? null,
    quality: top?.qualityLevel ?? null,
    rankOrder: top?.rankOrder ?? null
  };
}

// Quick test function to verify email selection logic (can be removed in production)
export function testEmailSelection() {
  const testEmails: AudienceAcuityEmail[] = [
    { email: 'test1@example.com', qualityLevel: 2, rankOrder: 1, optIn: false, updateDate: '2024-01-01' },
    { email: 'test2@example.com', qualityLevel: 0, rankOrder: 2, optIn: true, updateDate: '2024-06-01' }, // This should win (quality 0)
    { email: 'test3@example.com', qualityLevel: 1, rankOrder: 1, optIn: true, updateDate: '2024-12-01' },
    { email: 'test4@example.com', qualityLevel: 4, rankOrder: 1, optIn: true, updateDate: '2024-12-01' }
  ];
  
  const result = selectBestEmail(testEmails);
  console.log('Email selection test result:', result);
  console.log('Expected: test2@example.com with quality 0');
  
  return result?.email === 'test2@example.com' && result?.quality === 0;
}

/**
 * Find the email that matches the original MD5 hash from the enrichment response
 */
function findMatchingEmail(emails: AudienceAcuityEmail[], originalMd5: string): string | null {
  if (!emails || emails.length === 0) return null;
  
  // Find the email that matches the original MD5 hash
  const matchingEmail = emails.find(e => e.md5 === originalMd5);
  if (matchingEmail) {
    return matchingEmail.email;
  }
  
  // Fallback to first email if no MD5 match found
  return emails[0]?.email || null;
}

export function mapEnrichmentToDbFields(enrichment: AudienceAcuityEnrichment, originalMd5?: string) {
  // Existing "primary email" logic stays as-is:
  const primaryEmail =
    originalMd5 && enrichment.emails
      ? findMatchingEmail(enrichment.emails, originalMd5)
      : (enrichment.emails && enrichment.emails[0] ? enrichment.emails[0].email : null);

  // NEW: compute best email
  const best = selectBestEmail(enrichment.emails);

  return {
    firstName: enrichment.firstName || null,
    lastName: enrichment.lastName || null,
    address: enrichment.address || null,
    city: enrichment.city || null,
    state: enrichment.state || null,
    zip: enrichment.zip || null,
    gender: enrichment.gender || null,
    birthDate: enrichment.birthDate || null,
    
    email: primaryEmail || null,
    
    // 👇 NEW fields
    bestEmail: best?.email ?? null,
    bestEmailQuality: typeof best?.quality === "number" ? best.quality : null,
    householdIncome: enrichment.data?.householdIncome || null,
    homeOwnership: enrichment.data?.homeOwnership || null,
    lengthOfResidence: enrichment.data?.lengthOfResidence || null,
    age: enrichment.data?.age || null,
    maritalStatus: enrichment.data?.maritalStatus || null,
    householdPersons: enrichment.data?.householdPersons || null,
    householdChildren: enrichment.data?.householdChildren || null,
    mortgageLoanType: enrichment.data?.mortgageLoanType || null,
    mortgageAmount: enrichment.data?.mortgageAmount || null,
    mortgageAge: enrichment.data?.mortgageAge || null,
    homePrice: enrichment.data?.homePrice || null,
    homeValue: enrichment.data?.homeValue || null,
    ips: enrichment.ips ? JSON.stringify(enrichment.ips) : null,
    enrichmentStatus: "completed" as const,
    updatedAt: new Date(),
  };
}

/**
 * Test API credentials with OAuth 2.0 authentication
 * Used for troubleshooting OAuth and API connectivity issues
 */
export async function testApiCredentials(): Promise<{ success: boolean; error?: string; details?: any }> {
  try {
    console.log(`[${new Date().toISOString()}] Testing Audience Acuity OAuth 2.0 credentials...`);
    
    if (!AA_CLIENT_ID || !AA_CLIENT_SECRET) {
      return { success: false, error: 'Missing OAuth credentials' };
    }

    // Get authentication header (tries OAuth first, falls back to custom Bearer)
    let authHeader: string;
    try {
      authHeader = await getAuthHeader(true); // Enable debug
      console.log(`[${new Date().toISOString()}] Authentication header obtained (method: ${authMethod})`);
    } catch (authError: any) {
      console.error(`[${new Date().toISOString()}] Authentication failed:`, authError.message);
      return {
        success: false,
        error: `Authentication failed: ${authError.message}`,
        details: {
          step: 'authentication',
          clientId: AA_CLIENT_ID,
          secretPreview: AA_CLIENT_SECRET?.substring(0, 8) + '***'
        }
      };
    }

    // Test with a simple known MD5 hash using the preferred /byMd5 endpoint
    const testMd5 = '5d41402abc4b2a76b9719d911017c592'; // MD5 of 'hello'
    const testEndpoint = `/v2/identities/byMd5?md5=${testMd5}&template=${TEMPLATE_ID}`;
    const url = `${AA_ORIGIN}${testEndpoint}`;
    
    console.log(`[${new Date().toISOString()}] Testing endpoint: ${testEndpoint}`);
    console.log(`[${new Date().toISOString()}] Full URL: ${url}`);
    console.log(`[${new Date().toISOString()}] Auth method: ${authMethod}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout for testing
    });

    const responseText = await response.text();
    
    console.log(`[${new Date().toISOString()}] Test response status: ${response.status}`);
    console.log(`[${new Date().toISOString()}] Test response body: ${responseText}`);
    
    if (response.status === 401) {
      return { 
        success: false, 
        error: `Authentication failed using ${authMethod} method`,
        details: {
          status: response.status,
          response: responseText,
          clientId: AA_CLIENT_ID,
          secretPreview: AA_CLIENT_SECRET?.substring(0, 8) + '***',
          authMethod: authMethod
        }
      };
    } else if (response.status === 404) {
      // 404 is actually good - means authentication works but test MD5 not found
      return { 
        success: true, 
        details: {
          status: response.status,
          message: `Authentication valid using ${authMethod} method (404 expected for test MD5)`,
          response: responseText,
          template: TEMPLATE_ID,
          authMethod: authMethod
        }
      };
    } else if (response.ok) {
      return { 
        success: true, 
        details: {
          status: response.status,
          message: `Authentication valid using ${authMethod} method and test MD5 found`,
          response: responseText,
          template: TEMPLATE_ID,
          authMethod: authMethod
        }
      };
    } else {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        details: {
          status: response.status,
          response: responseText,
          template: TEMPLATE_ID,
          authMethod: authMethod
        }
      };
    }
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Credential test failed:`, error.message);
    return {
      success: false,
      error: error.message,
      details: { errorType: error.name }
    };
  }
}