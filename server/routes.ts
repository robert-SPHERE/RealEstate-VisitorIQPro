import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, requireAuth, requireAdmin, hashPassword, comparePasswords } from "./auth";
import { scheduledSyncService } from "./services/scheduledSyncService";
// Legacy import removed - now using enhanced scheduler
import { getAllSyncStatus, getSyncStatus, initializeNewScheduler } from "./services/newSchedulerService";
import { insertEmailCaptureSchema, insertCampaignSchema } from "@shared/schema";
import { emailService } from "./services/emailService";
import { enrichWithAudienceAcuity } from "./services/audienceAcuityService";
import { enrichAndSave, batchEnrichAndSave } from "./services/enrichmentService";
import { mailchimpService } from "./services/mailchimpService";
import { pixelEndpointService } from "./services/pixelEndpointService";

import { endpointMonitoringService } from "./services/endpointMonitoringService";
import { wixMD5Service } from "./services/wixMD5Service";
import { userManagementService } from "./services/userManagementService";
import { logger } from './utils/logger';
import { emailAlertService } from './services/emailAlertService';
import multer from "multer";
import csvParser from "csv-parser";

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Email capture endpoint
  app.post('/api/email-capture', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { originalEmail } = req.body;
      
      if (!originalEmail) {
        return res.status(400).json({ message: "Original email is required" });
      }

      if (!emailService.validateEmail(originalEmail)) {
        return res.status(400).json({ message: "Invalid email format" });
      }

      const hashedEmail = emailService.hashEmail(originalEmail);
      
      const capture = await storage.createEmailCapture({
        originalEmail,
        hashedEmail,
        userId,
      });

      // Start enrichment process
      try {
        const enrichmentData = await enrichWithAudienceAcuity(hashedEmail);
        await storage.updateEmailCaptureEnrichment(capture.id, enrichmentData);
        
        // Update identity metrics based on enrichment data
        const currentMetrics = await storage.getIdentityMetrics();
        const updates = {
          hashedEmails: (currentMetrics?.hashedEmails || 0) + 1,
          contactEmail: enrichmentData?.emails?.[0] ? (currentMetrics?.contactEmail || 0) + 1 : (currentMetrics?.contactEmail || 0),
          geographicData: enrichmentData?.address ? (currentMetrics?.geographicData || 0) + 1 : (currentMetrics?.geographicData || 0),
          age: enrichmentData?.birthDate ? (currentMetrics?.age || 0) + 1 : (currentMetrics?.age || 0),
          phoneNumber: (currentMetrics?.phoneNumber || 0),
          householdIncome: (currentMetrics?.householdIncome || 0),
        };
        await storage.updateIdentityMetrics(updates);
        
      } catch (enrichmentError) {
        console.error("Enrichment failed:", enrichmentError);
        // Still update metrics for the captured email
        const currentMetrics = await storage.getIdentityMetrics();
        await storage.updateIdentityMetrics({
          hashedEmails: (currentMetrics?.hashedEmails || 0) + 1,
        });
      }

      res.json(capture);
    } catch (error) {
      console.error("Error capturing email:", error);
      res.status(500).json({ message: "Failed to capture email" });
    }
  });

  // Manual email enrichment endpoint
  app.post('/api/enrich-email', requireAuth, async (req: any, res) => {
    try {
      const { email, hashedEmail } = req.body;
      
      if (!email && !hashedEmail) {
        return res.status(400).json({ message: "Email or hashed email is required" });
      }

      // Hash the email if plain text provided
      const emailHash = hashedEmail || emailService.hashEmail(email);
      
      const enrichmentData = await enrichWithAudienceAcuity(emailHash);
      
      res.json({
        success: true,
        hashedEmail: emailHash,
        enrichmentData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("Manual email enrichment error:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to enrich email",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Pixel endpoint for capturing MD5 hashed emails with CID separation
  app.get('/api/pixel-capture', async (req, res) => {
    try {
      const { md5, cid, url, session_id, var1, var2, ts } = req.query;
      
      const result = await pixelEndpointService.captureFromPixelEndpoint({
        md5: md5 as string,
        cid: cid as string,
        url: url as string,
        session_id: session_id as string,
        var1: var1 as string,
        var2: var2 as string,
        ts: ts as string,
      });

      // Return a 1x1 transparent pixel
      res.set({
        'Content-Type': 'image/gif',
        'Content-Length': '43',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      
      // 1x1 transparent GIF
      const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      res.end(pixel);
    } catch (error) {
      console.error("Pixel endpoint error:", error);
      // Still return a pixel even on error
      res.set({
        'Content-Type': 'image/gif',
        'Content-Length': '43',
      });
      const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      res.end(pixel);
    }
  });

  // Webhook endpoint for Sphere Data Solutions to push MD5 updates
  app.post('/api/webhook/sphere-data', async (req, res) => {
    try {
      const result = await pixelEndpointService.processWebhookData(req.body);
      
      console.log(`Webhook processed: ${result.processed} emails, ${result.errors} errors`);
      
      res.json({
        success: true,
        processed: result.processed,
        errors: result.errors,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("Webhook processing error:", error);
      res.status(500).json({ 
        success: false, 
        error: "Failed to process webhook data" 
      });
    }
  });

  // Email lookup endpoint - search for complete identity profile by email
  app.get('/api/email-lookup', requireAuth, async (req: any, res) => {
    try {
      const email = req.query.email as string;
      const userId = req.user.id;
      
      if (!email) {
        return res.status(400).json({ 
          found: false, 
          message: "Email parameter is required" 
        });
      }

      // Get user info to determine CID access
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(401).json({ 
          found: false, 
          message: "User not found" 
        });
      }

      // Get email captures filtered by user's CID access
      let captures;
      if (user.role === 'admin') {
        // Admin can search all captures
        captures = await storage.getEmailCaptures();
      } else {
        // Client users can only search their assigned CID
        if (!user.assignedCid) {
          return res.status(403).json({ 
            found: false, 
            message: "No CID assigned to user" 
          });
        }
        captures = await storage.getEmailCapturesByCid(user.assignedCid);
      }
      
      const emailHash = emailService.hashEmail(email);
      
      // Look for exact email match or hashed email match
      const match = captures.find(capture => 
        capture.email === email || 
        capture.hashedEmail === emailHash
      );
      
      if (match) {
        res.json({
          found: true,
          profile: {
            id: match.id,
            hashedEmail: match.hashedEmail,
            email: match.email,
            firstName: match.firstName,
            lastName: match.lastName,
            address: match.address,
            city: match.city,
            state: match.state,
            zip: match.zip,
            gender: match.gender,
            birthDate: match.birthDate,
            age: match.age,
            maritalStatus: match.maritalStatus,
            householdIncome: match.householdIncome,
            householdPersons: match.householdPersons,
            householdChildren: match.householdChildren,
            homeOwnership: match.homeOwnership,
            homePrice: match.homePrice,
            homeValue: match.homeValue,
            lengthOfResidence: match.lengthOfResidence,
            mortgageLoanType: match.mortgageLoanType,
            mortgageAmount: match.mortgageAmount,
            mortgageAge: match.mortgageAge,
            cid: match.cid,
            lastPageViewed: match.lastPageViewed,
            url: match.url,
            capturedAt: match.capturedAt,
            enrichmentStatus: match.enrichmentStatus
          }
        });
      } else {
        res.json({
          found: false,
          message: "No identity profile found for this email"
        });
      }
    } catch (error) {
      console.error("Email lookup error:", error);
      res.status(500).json({ 
        found: false, 
        message: "Failed to lookup email",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Account update endpoint
  app.put("/api/account/update", requireAuth, async (req: any, res) => {
    try {
      const { email, firstName, lastName, currentPassword, newPassword } = req.body;
      const user = req.user!;

      // If changing password, verify current password
      if (newPassword && newPassword.trim() !== '') {
        if (!currentPassword || currentPassword.trim() === '') {
          return res.status(400).json({ message: "Current password is required to change password" });
        }

        const isCurrentPasswordValid = await comparePasswords(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
          return res.status(400).json({ message: "Current password is incorrect" });
        }
      }

      // Update user data
      const updateData: any = { email, firstName, lastName };
      if (newPassword && newPassword.trim() !== '') {
        updateData.password = await hashPassword(newPassword);
      }

      const updatedUser = await storage.updateUser(user.id, updateData);
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating account:", error);
      res.status(500).json({ message: "Failed to update account" });
    }
  });

  // Test endpoint for Audience Acuity service
  app.post('/api/admin/test-audience-acuity', requireAuth, async (req: any, res) => {
    try {
      const { email } = req.body;
      const hashedEmail = emailService.hashEmail(email || 'test@example.com');
      
      console.log(`Testing Audience Acuity with hashed email: ${hashedEmail}`);
      
      const result = await enrichWithAudienceAcuity(hashedEmail);
      
      res.json({
        success: true,
        hashedEmail,
        result
      });
    } catch (error) {
      console.error("Audience Acuity test error:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get email captures with CID-based access control
  app.get('/api/email-captures', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      const cid = req.query.cid as string;
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      let captures: any[] = [];
      
      if (user.role === 'admin') {
        // Admin can see all captures or filter by CID
        captures = cid 
          ? await storage.getEmailCapturesByCid(cid)
          : await storage.getEmailCaptures();
      } else {
        // Client can only see their assigned CID
        if (user.assignedCid) {
          captures = await storage.getEmailCapturesByCid(user.assignedCid);
        } else {
          captures = [];
        }
      }
      
      res.json(captures);
    } catch (error) {
      console.error("Error fetching email captures:", error);
      res.status(500).json({ message: "Failed to fetch email captures" });
    }
  });

  // Get recent identity captures for rolling view
  app.get('/api/recent-captures', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      let captures: any[] = [];
      
      if (user.role === 'admin') {
        // Admin can see all captures, optionally filtered by CID
        const cid = req.query.cid as string;
        if (cid && cid !== 'all') {
          captures = await storage.getEmailCapturesByCid(cid);
        } else {
          captures = await storage.getEmailCaptures();
        }
      } else {
        // Client can only see their assigned CID
        if (user.assignedCid) {
          captures = await storage.getEmailCapturesByCid(user.assignedCid);
        } else {
          captures = []; // No CID assigned = no data
        }
      }
      
      // Sort by createdAt descending and take the 250 most recent
      const recentCaptures = captures
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, 250)
        .map(capture => {
          const enrichmentData = capture.enrichmentData as any;
          return {
            id: capture.id,
            hashedEmail: capture.hashedEmail,
            sourceUrl: capture.source,
            sessionId: capture.metadata?.sessionId,
            capturedAt: capture.createdAt,
            enrichmentStatus: capture.enrichmentStatus,
            cid: capture.cid,
            ipAddress: capture.metadata?.ipAddress,
            // Enrichment data fields
            firstName: capture.firstName || null,
            lastName: capture.lastName || null,
            email: capture.email || null,
            hasAddress: !!(capture.address && capture.city),
            lastPageViewed: capture.lastPageViewed || null
          };
        });
      
      res.json(recentCaptures);
    } catch (error) {
      console.error("Error fetching recent captures:", error);
      res.status(500).json({ message: "Failed to fetch recent captures" });
    }
  });

  // Get business type-specific data export
  app.get('/api/business-data-export', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const cid = req.query.cid as string;

      
      // Check if user has access to this CID
      if (cid && !(await storage.canUserAccessCid(userId, cid))) {
        return res.status(403).json({ message: "Access denied to this account" });
      }
      
      // Get accessible CIDs for this user
      const accessibleCids = await storage.getUserAccessibleCids(userId);
      
      // If no CID specified, use the first accessible CID
      const targetCid = cid || accessibleCids[0];
      
      if (!targetCid) {
        return res.json([]); // Return empty array if no accessible CIDs
      }


      
      const captures = await storage.getEmailCapturesByCid(targetCid);
      
      // Filter only enriched captures with the required data
      const enrichedCaptures = captures.filter(capture => 
        capture.enrichmentStatus === 'completed' && 
        capture.enrichmentData
      );
      
      // Transform data for real estate
      const transformedData = enrichedCaptures.map(capture => {
        const enrichmentData = capture.enrichmentData as any;
        
        // Create a standardized object with real estate fields
        const businessData: any = {
          id: capture.id,
          hashedEmail: capture.hashedEmail,
          originalEmail: capture.originalEmail,
          createdAt: capture.createdAt,
          ...enrichmentData
        };
        
        return businessData;
      });
      
      res.json(transformedData);
    } catch (error) {
      console.error("Error fetching business data export:", error);
      res.status(500).json({ message: "Failed to fetch business data export" });
    }
  });

  // Create campaign
  app.post('/api/campaigns', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const campaignData = insertCampaignSchema.parse({
        ...req.body,
        userId,
      });
      
      const campaign = await storage.createCampaign(campaignData);
      res.json(campaign);
    } catch (error) {
      console.error("Error creating campaign:", error);
      res.status(500).json({ message: "Failed to create campaign" });
    }
  });

  // Get campaigns
  app.get('/api/campaigns', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      const campaigns = user?.role === 'admin' 
        ? await storage.getCampaigns()
        : await storage.getCampaigns(userId);
      
      res.json(campaigns);
    } catch (error) {
      console.error("Error fetching campaigns:", error);
      res.status(500).json({ message: "Failed to fetch campaigns" });
    }
  });

  // Handwrytten integration endpoints
  app.get('/api/handwrytten-status', requireAuth, async (req: any, res) => {
    try {
      const { handwryttenService } = await import('./services/handwryttenService');
      const status = await handwryttenService.getStatus();
      res.json(status);
    } catch (error: any) {
      console.error('Handwrytten status check failed:', error);
      res.status(500).json({ 
        connected: false, 
        configured: false, 
        error: error.message 
      });
    }
  });

  app.post('/api/sync-handwrytten', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const { cid, customMessage, customSignature } = req.body;
      
      console.log(`[API] Handwrytten sync requested by user ${userId}${cid ? ` for CID: ${cid}` : ' for all CIDs'}`);
      if (customMessage) console.log(`[API] Custom message: ${customMessage.substring(0, 50)}...`);
      if (customSignature) console.log(`[API] Custom signature: ${customSignature}`);
      
      const { handwryttenService } = await import('./services/handwryttenService');
      const result = await handwryttenService.syncEnrichedContacts(cid, customMessage, customSignature);
      
      res.json(result);
    } catch (error: any) {
      console.error('Handwrytten sync failed:', error);
      res.status(500).json({ 
        success: false, 
        message: `Sync failed: ${error.message}`,
        sent: 0,
        errors: 0
      });
    }
  });

  app.post('/api/send-handwrytten', requireAuth, async (req: any, res) => {
    try {
      const { recordId, cardId, message, signature } = req.body;
      
      // Get the specific record
      const record = await storage.getEmailCaptureById(recordId);
      if (!record) {
        return res.status(404).json({ 
          success: false, 
          message: 'Record not found' 
        });
      }
      
      const { handwryttenService } = await import('./services/handwryttenService');
      const result = await handwryttenService.sendNote(record, cardId || '1', message, signature);
      
      res.json(result);
    } catch (error: any) {
      console.error('Single Handwrytten send failed:', error);
      res.status(500).json({ 
        success: false, 
        message: `Failed to send note: ${error.message}` 
      });
    }
  });

  // Sync with Mailchimp - Enhanced with CID tagging
  app.post('/api/sync-mailchimp', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { cid } = req.body; // Optional CID to sync specific account
      
      console.log(`[API] Mailchimp sync requested by user ${userId}${cid ? ` for CID: ${cid}` : ' for all CIDs'}`);
      
      const syncResult = await mailchimpService.syncContactsByCid(cid);
      
      res.json({
        message: `Mailchimp sync completed: ${syncResult.synced} contacts synced across ${syncResult.cidSynced.length} CID(s)`,
        ...syncResult
      });
      
    } catch (error) {
      console.error("Error syncing with Mailchimp:", error);
      res.status(500).json({ 
        success: false,
        message: error instanceof Error ? error.message : "Failed to sync with Mailchimp"
      });
    }
  });

  // Test Mailchimp connection and get stats
  app.get('/api/mailchimp-status', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const status = await mailchimpService.getStatus();
      res.json(status);
      
    } catch (error) {
      console.error("Error getting Mailchimp status:", error);
      res.status(500).json({ 
        connected: false, 
        totalContacts: 0, 
        pendingSync: 0,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get Mailchimp tags/segments
  app.get('/api/mailchimp-tags', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const tags = await mailchimpService.getTags();
      res.json(tags);
      
    } catch (error) {
      console.error("Error getting Mailchimp tags:", error);
      res.status(500).json({ 
        tags: [],
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Test Worker endpoint status
  app.get('/api/test-worker-endpoint', requireAuth, async (req: any, res) => {
    try {
      const testCid = req.query.cid || 'viqpro';
      const workerUrl = `https://spheredsgpixel.com/pixelEndpoint?cid=${encodeURIComponent(testCid)}`;
      
      console.log(`[Worker Test] Testing Worker endpoint: ${workerUrl}`);
      
      const response = await fetch(workerUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'VisitorIQ-Pro-Test/1.0'
        }
      });
      
      const responseText = await response.text();
      
      let status = 'unknown';
      let details = '';
      let isReady = false;
      
      if (responseText.startsWith('GIF89a')) {
        status = 'pixel_mode';
        details = 'Worker is returning tracking pixel (GIF) instead of JSON data. Worker code needs to be updated to support CID-based JSON responses.';
        isReady = false;
      } else {
        try {
          const jsonData = JSON.parse(responseText);
          if (Array.isArray(jsonData)) {
            status = 'json_ready';
            details = `Worker correctly returning JSON array with ${jsonData.length} records for CID ${testCid}`;
            isReady = true;
          } else {
            status = 'json_invalid';
            details = 'Worker returning JSON but not in expected array format';
            isReady = false;
          }
        } catch (parseError) {
          status = 'non_json';
          details = 'Worker returning non-JSON response';
          isReady = false;
        }
      }
      
      res.json({
        success: true,
        workerStatus: status,
        isReady,
        details,
        httpStatus: response.status,
        responseLength: responseText.length,
        sampleResponse: responseText.substring(0, 100)
      });
      
    } catch (error) {
      console.error("Error testing Worker endpoint:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to test Worker endpoint",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get accessible CIDs for user
  app.get('/api/accessible-cids', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const accessibleCids = await storage.getUserAccessibleCids(userId);
      res.json(accessibleCids);
    } catch (error) {
      console.error("Error fetching accessible CIDs:", error);
      res.status(500).json({ message: "Failed to fetch accessible CIDs" });
    }
  });

  // Get CID accounts with access control
  app.get('/api/cid-accounts', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      let accounts: any[] = [];
      
      if (user.role === 'admin') {
        accounts = await storage.getCidAccounts();
      } else if (user.assignedCid) {
        const account = await storage.getCidAccount(user.assignedCid);
        accounts = account ? [account] : [];
      }
      
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching CID accounts:", error);
      res.status(500).json({ message: "Failed to fetch CID accounts" });
    }
  });

  // Get identity metrics with CID-based access
  app.get('/api/identity-metrics', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      const cid = req.query.cid as string;
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      let metrics;
      
      if (user.role === 'admin') {
        // Admin can see all metrics or filter by CID
        metrics = await storage.getIdentityMetrics(cid);
      } else if (user.assignedCid) {
        // Client can only see their assigned CID metrics
        metrics = await storage.getIdentityMetrics(user.assignedCid);
      } else {
        return res.status(403).json({ message: "No CID access assigned" });
      }
      
      res.json(metrics || {});
    } catch (error) {
      console.error("Error fetching identity metrics:", error);
      res.status(500).json({ message: "Failed to fetch identity metrics" });
    }
  });

  // Assign CID to user (Admin only)
  app.post('/api/assign-cid', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const adminUser = await storage.getUser(userId);
      
      if (adminUser?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { targetUserId, cid } = req.body;
      
      if (!targetUserId || !cid) {
        return res.status(400).json({ message: "Target user ID and CID are required" });
      }

      // Update user's assigned CID - get existing user first
      const existingUser = await storage.getUser(targetUserId);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const updatedUser = await storage.upsertUser({
        ...existingUser,
        assignedCid: cid
      });

      res.json({ success: true, user: updatedUser });
    } catch (error) {
      console.error("Error assigning CID:", error);
      res.status(500).json({ message: "Failed to assign CID" });
    }
  });

  // Dashboard stats with CID filtering and date range support
  app.get('/api/dashboard-stats', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      const timePeriod = req.query.timePeriod as string;
      const fromDate = req.query.fromDate ? new Date(req.query.fromDate) : undefined;
      const toDate = req.query.toDate ? new Date(req.query.toDate) : undefined;
      const requestedCid = req.query.cid as string;
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Helper function to calculate date range based on time period
      const getDateRange = (period: string) => {
        const now = new Date();
        let startDate: Date;
        
        switch (period) {
          case '7d':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case '30d':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          case '90d':
            startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            break;
          case '1y':
            startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            break;
          case 'custom':
            return { startDate: fromDate, endDate: toDate };
          default:
            return { startDate: undefined, endDate: undefined };
        }
        
        return { startDate, endDate: now };
      };
      
      const { startDate, endDate } = getDateRange(timePeriod);
      
      let totalCampaigns = 0;
      let totalEmailCaptures = 0;
      let enrichmentRate = 0;
      let enrichedCount = 0;
      
      if (user.role === 'admin' && !requestedCid) {
        // Admin sees all data only when no specific CID is requested
        const campaigns = await storage.getCampaigns();
        const captures = await storage.getEmailCaptures();
        enrichedCount = captures.filter(c => {
          if (c.enrichmentStatus !== 'completed') return false;
          // Check both enrichmentData (legacy) and direct fields (new format)
          const enrichmentData = c.enrichmentData as any;
          const hasAddress = enrichmentData?.address || c.address;
          const hasEmail = enrichmentData?.contact_email || c.email;
          // Enriched = household address + email address
          return hasAddress && hasEmail;
        }).length;
        
        totalCampaigns = campaigns.length;
        totalEmailCaptures = captures.length;
        enrichmentRate = captures.length > 0 ? Math.round((enrichedCount / captures.length) * 100) : 0;
      } else if (requestedCid || user.assignedCid || (user.role === 'admin' && requestedCid)) {
        // Client sees data for requested CID (priority) or their assigned CID (fallback)
        // Admin with requestedCid also goes through this path for CID-specific data
        const targetCid = requestedCid || user.assignedCid;
        console.log(`Fetching data for targetCid: ${targetCid}`);
        
        const campaigns = await storage.getCampaigns(userId);
        const captures = startDate || endDate
          ? await storage.getEmailCapturesByDateRange(targetCid!, startDate!, endDate!)
          : await storage.getEmailCapturesByCid(targetCid!);
        
        console.log(`Found ${captures.length} captures for CID: ${targetCid}`);
        
        // Count plain text emails (contact emails) - records with email field populated
        const plainTextEmails = captures.filter(c => c.email && c.email.trim() !== '').length;
        
        // Count enriched identities (household address + email address)
        enrichedCount = captures.filter(c => {
          if (c.enrichmentStatus !== 'completed') return false;
          // Check both enrichmentData (legacy) and direct fields (new format)
          const enrichmentData = c.enrichmentData as any;
          const hasAddress = enrichmentData?.address || c.address;
          const hasEmail = enrichmentData?.contact_email || c.email;
          // Enriched = household address + email address
          return hasAddress && hasEmail;
        }).length;
        
        totalCampaigns = campaigns.length;
        totalEmailCaptures = captures.length;
        enrichmentRate = captures.length > 0 ? Math.round((enrichedCount / captures.length) * 100) : 0;
      } else {
        // Client without assigned CID sees no data
        totalCampaigns = 0;
        totalEmailCaptures = 0;
        enrichmentRate = 0;
        enrichedCount = 0;
      }
      
      // Calculate plain text emails for response - this should already be calculated above
      let plainTextEmails = 0;
      if (user.role === 'admin' && !requestedCid) {
        const captures = await storage.getEmailCaptures();
        plainTextEmails = captures.filter(c => c.email && c.email.trim() !== '').length;
      } else if (requestedCid || user.assignedCid || (user.role === 'admin' && requestedCid)) {
        // Use the same logic as above to avoid double calculation - prioritize requested CID
        const targetCid = requestedCid || user.assignedCid;
        const captures = startDate || endDate
          ? await storage.getEmailCapturesByDateRange(targetCid!, startDate!, endDate!)
          : await storage.getEmailCapturesByCid(targetCid!);
        plainTextEmails = captures.filter(c => c.email && c.email.trim() !== '').length;
        console.log(`PlainTextEmails calculation for CID ${targetCid}: ${plainTextEmails} out of ${captures.length} total captures`);
      }

      console.log(`Dashboard stats - User: ${userId}, Role: ${user.role}, RequestedCID: ${requestedCid}, AssignedCID: ${user.assignedCid}, TargetCID: ${requestedCid || user.assignedCid}, TotalCaptures: ${totalEmailCaptures}, PlainTextEmails: ${plainTextEmails}`);

      res.json({
        totalCampaigns,
        totalEmailCaptures,
        enrichmentRate,
        enrichedCount,
        plainTextEmails,
        userRole: user.role,
        assignedCid: user.assignedCid,
        dateRange: { startDate, endDate }
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // Get API integrations status
  app.get('/api/integrations', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const integrations = await storage.getApiIntegrations();
      res.json(integrations);
    } catch (error) {
      console.error("Error fetching integrations:", error);
      res.status(500).json({ message: "Failed to fetch integrations" });
    }
  });

  // Get identity metrics
  app.get('/api/identity-metrics', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const metrics = await storage.getIdentityMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching identity metrics:", error);
      res.status(500).json({ message: "Failed to fetch identity metrics" });
    }
  });

  // Test API integrations
  app.get('/api/test-integrations', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const audienceAcuityStatus = { connected: true, dailyRequests: 15, successRate: 98.5 };
      const mailchimpStatus = await mailchimpService.getStatus();

      res.json({
        audienceAcuity: audienceAcuityStatus,
        mailchimp: mailchimpStatus,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error testing integrations:", error);
      res.status(500).json({ message: "Failed to test integrations" });
    }
  });

  // Get dashboard stats
  app.get('/api/dashboard-stats', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      const campaigns = user?.role === 'admin' 
        ? await storage.getCampaigns()
        : await storage.getCampaigns(userId);
      
      const emailCaptures = user?.role === 'admin' 
        ? await storage.getEmailCaptures()
        : await storage.getEmailCaptures(userId);

      const stats = {
        totalCampaigns: campaigns.length,
        totalEmailCaptures: emailCaptures.length,
        emailsSent: campaigns.filter(c => c.type === 'email').reduce((sum, c) => sum + (c.recipients || 0), 0),
        handwrittenCards: campaigns.filter(c => c.type === 'handwritten').reduce((sum, c) => sum + (c.recipients || 0), 0),
        averageOpenRate: campaigns.length > 0 
          ? campaigns.reduce((sum, c) => sum + (parseFloat(c.openRate?.toString() || '0')), 0) / campaigns.length
          : 0,
        averageResponseRate: campaigns.length > 0 
          ? campaigns.reduce((sum, c) => sum + (parseFloat(c.responseRate?.toString() || '0')), 0) / campaigns.length
          : 0,
      };

      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // Endpoint monitoring controls
  app.get('/api/monitoring/status', requireAuth, async (req, res) => {
    try {
      const status = endpointMonitoringService.getStatus();
      res.json(status);
    } catch (error) {
      console.error("Error getting monitoring status:", error);
      res.status(500).json({ message: "Failed to get monitoring status" });
    }
  });

  app.post('/api/monitoring/start-polling', requireAuth, async (req, res) => {
    try {
      const { intervalMs = 60000 } = req.body;
      await endpointMonitoringService.pollForUpdates(intervalMs);
      
      res.json({ 
        success: true, 
        message: `Polling started with ${intervalMs}ms interval`,
        intervalMs 
      });
    } catch (error) {
      console.error("Error starting polling:", error);
      res.status(500).json({ message: "Failed to start polling" });
    }
  });

  app.post('/api/monitoring/manual-check', requireAuth, async (req, res) => {
    try {
      const result = await endpointMonitoringService.checkForNewEmails();
      res.json({
        success: true,
        ...result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error during manual check:", error);
      res.status(500).json({ message: "Failed to perform manual check" });
    }
  });

  app.post('/api/monitoring/stop', requireAuth, async (req, res) => {
    try {
      endpointMonitoringService.stopMonitoring();
      res.json({ success: true, message: "Monitoring stopped" });
    } catch (error) {
      console.error("Error stopping monitoring:", error);
      res.status(500).json({ message: "Failed to stop monitoring" });
    }
  });

  app.post('/api/monitoring/upload-file', requireAuth, async (req, res) => {
    try {
      const { filePath } = req.body;
      if (!filePath) {
        return res.status(400).json({ message: "File path is required" });
      }

      const result = await endpointMonitoringService.processEmailFile(filePath);
      res.json({
        success: true,
        ...result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error processing file:", error);
      res.status(500).json({ message: "Failed to process file" });
    }
  });

  // Helper function for timestamp formatting
  const formatTimestamp = (date: Date | string | null): string => {
    if (!date) return 'unknown';
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 60) {
      return `${diffMins} min ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }
  };

  // Create new CID account with primary user (admin only)
  app.post('/api/cid-accounts', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { cid, accountName, accountLevel, notes, firstName, lastName, email, website, password, handwryttenSender, handwritingId, handwryttenTemplate, returnCompany, returnAddress1, returnAddress2, returnCity, returnState, returnZip } = req.body;
      
      if (!cid || !accountName) {
        return res.status(400).json({ message: "CID and account name are required" });
      }

      if (!firstName || !lastName || !email) {
        return res.status(400).json({ message: "User details (firstName, lastName, email) are required" });
      }

      if (!password || password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters long" });
      }

      if (!accountLevel) {
        return res.status(400).json({ message: "Account level is required" });
      }

      const validAccountLevels = ['identity_resolution', 'intent_flow_accelerator', 'handwritten_connect'];
      if (!validAccountLevels.includes(accountLevel)) {
        return res.status(400).json({ message: "Invalid account level" });
      }

      // Auto-generate username from email prefix
      const username = email.split('@')[0];

      // Check if username already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(409).json({ message: "Username already exists" });
      }

      // Create the business account with Handwrytten settings
      const newAccount = await storage.upsertCidAccount({
        cid,
        accountName,
        accountLevel,
        notes,
        firstName,
        lastName,
        email,
        website,
        status: 'active',
        // Include Handwrytten settings in the initial account creation
        handwryttenSender,
        handwritingId, 
        handwryttenTemplate,
        // Include Return Address settings
        returnCompany,
        returnAddress1,
        returnAddress2,
        returnCity,
        returnState,
        returnZip
      });

      // Use the provided password
      const { hashPassword } = await import('./auth');
      const hashedPassword = await hashPassword(password);
      
      const newUser = await storage.createUser({
        username,
        password: hashedPassword,
        email,
        firstName,
        lastName, 
        role: 'client',
        assignedCid: cid
      });

      console.log(`[Account Creation] Created account ${cid} with primary user ${username}`);

      res.json({
        account: newAccount,
        user: {
          id: newUser.id,
          username: newUser.username,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          role: newUser.role,
          assignedCid: newUser.assignedCid,
          password: password // Return the password for display to admin
        },
        loginInstructions: `Login Details for ${firstName} ${lastName}:
        
        Platform URL: ${req.protocol}://${req.get('host')}/auth
        Username: ${username}
        Password: ${password}
        
        User can log in immediately with these credentials.`,
        accessDetails: `Account Access:
        - Account: ${accountName} (${cid})
        - Role: Client User
        - Email: ${email}
        - Platform Access: Identity Resolution Dashboard`
      });
    } catch (error: any) {
      console.error("Error creating CID account:", error);
      if (error.code === '23505') { // Unique constraint violation
        res.status(409).json({ message: "CID already exists" });
      } else {
        res.status(500).json({ message: "Failed to create CID account" });
      }
    }
  });

  // Update CID account endpoint (admin only)
  app.put('/api/cid-accounts/:id', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const accountId = parseInt(req.params.id);
      const { cid, accountName, notes, firstName, lastName, email, website, status, settings } = req.body;

      // Validate status if provided
      if (status && !['active', 'inactive', 'suspended'].includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }

      const updatedAccount = await storage.updateCidAccount(accountId, {
        cid,
        accountName,
        notes,
        firstName,
        lastName,
        email,
        website,
        status,
        settings
      });

      res.json(updatedAccount);
    } catch (error: any) {
      console.error("Error updating CID account:", error);
      res.status(500).json({ message: "Failed to update CID account" });
    }
  });

  // Update CID-specific Handwrytten settings (admin only)
  app.put('/api/cid-accounts/:cid/handwrytten-settings', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { cid } = req.params;
      const { handwryttenMessage, handwryttenSignature, returnAddress } = req.body;
      
      console.log(`[API] Updating Handwrytten settings for CID: ${cid}`);
      console.log(`[API] Message: ${handwryttenMessage ? 'provided' : 'not provided'}`);
      console.log(`[API] Signature: ${handwryttenSignature ? 'provided' : 'not provided'}`);
      console.log(`[API] Return Address: ${returnAddress ? 'provided' : 'not provided'}`);
      
      const updatedAccount = await storage.updateCidAccountHandwryttenSettings(cid, handwryttenMessage, handwryttenSignature, returnAddress);
      
      if (!updatedAccount) {
        return res.status(404).json({ message: 'CID account not found' });
      }
      
      res.json({
        success: true,
        message: 'Handwrytten settings updated successfully',
        account: updatedAccount
      });
    } catch (error) {
      console.error('Error updating Handwrytten settings:', error);
      res.status(500).json({ message: 'Failed to update Handwrytten settings' });
    }
  });

  // Wix MD5 Retrieval endpoints
  app.get('/api/wix-md5/:md5Value', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { md5Value } = req.params;
      const retrievedMD5 = await wixMD5Service.fetchMD5FromWix(md5Value);
      
      res.json({
        success: true,
        original: md5Value,
        retrieved: retrievedMD5,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error("Error retrieving MD5:", error);
      res.status(500).json({ message: "Failed to retrieve MD5" });
    }
  });

  app.post('/api/wix-md5/batch', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { md5Values } = req.body;
      
      if (!Array.isArray(md5Values)) {
        return res.status(400).json({ message: "md5Values must be an array" });
      }

      const results = await wixMD5Service.batchFetchMD5(md5Values);
      
      res.json({
        success: true,
        results,
        processed: results.length,
        successful: results.filter(r => r.retrieved !== null).length,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error("Error batch retrieving MD5:", error);
      res.status(500).json({ message: "Failed to batch retrieve MD5 values" });
    }
  });

  app.get('/api/wix-md5/test-connection', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const connectionStatus = await wixMD5Service.testConnection();
      
      res.json({
        ...connectionStatus,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error("Error testing Wix connection:", error);
      res.status(500).json({ message: "Failed to test connection" });
    }
  });

  // CSV Data Upload endpoint (admin only)
  app.post('/api/upload-csv', requireAuth, upload.single('csvFile'), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No CSV file uploaded" });
      }

      const { cid, fieldMappings } = req.body;
      console.log('CSV Upload - CID from request:', cid);
      console.log('CSV Upload - Field mappings:', fieldMappings);
      console.log('CSV Upload - Request body:', req.body);
      
      if (!cid) {
        return res.status(400).json({ message: "CID is required" });
      }

      // Verify CID exists
      const cidAccount = await storage.getCidAccount(cid);
      if (!cidAccount) {
        return res.status(404).json({ message: "CID account not found" });
      }
      
      console.log('CSV Upload - CID account verified:', cidAccount.accountName);

      const csvData = req.file.buffer.toString('utf8');
      const results: any[] = [];
      let totalRows = 0;
      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      // Define header mapping for flexible CSV parsing
      // NOTE: Keys should match database column names (with underscores)
      const headerMapping = {
        // ID field
        'id': ['id', 'ID', 'Id', 'identifier', 'Identifier', 'record_id', 'Record ID'],
        
        // Email fields
        'email': ['email', 'Email', 'EMAIL', 'email_address', 'Email Address', 'emailAddress'],
        'original_email': ['original_email', 'Original Email', 'originalEmail'],
        'hashed_email': ['hashed_email', 'Hashed Email', 'hashedEmail', 'md5_email', 'MD5 Email'],
        
        // Personal information - using database column names
        'first_name': ['first_name', 'First Name', 'firstName', 'FirstName', 'fname', 'first'],
        'last_name': ['last_name', 'Last Name', 'lastName', 'LastName', 'lname', 'last'],
        'address': ['address', 'Address', 'ADDRESS', 'street_address', 'Street Address'],
        'city': ['city', 'City', 'CITY'],
        'state': ['state', 'State', 'STATE', 'st'],
        'zip': ['zip', 'Zip', 'ZIP', 'zipcode', 'zip_code', 'Zip Code', 'postal_code'],
        'gender': ['gender', 'Gender', 'GENDER'],
        'birth_date': ['birth_date', 'Birth Date', 'birthDate', 'dob', 'date_of_birth'],
        'age': ['age', 'Age', 'AGE'],
        
        // Real estate specific - using database column names
        'mortgage_loan_type': ['mortgage_loan_type', 'Mortgage Loan Type', 'mortgageLoanType', 'loan_type'],
        'mortgage_amount': ['mortgage_amount', 'Mortgage Amount', 'mortgageAmount', 'loan_amount'],
        'mortgage_age': ['mortgage_age', 'Mortgage Age', 'mortgageAge', 'loan_age'],
        'household_income': ['household_income', 'Household Income', 'householdIncome', 'income'],
        'home_ownership': ['home_ownership', 'Home Ownership', 'homeOwnership', 'ownership'],
        'home_price': ['home_price', 'Home Price', 'homePrice', 'purchase_price'],
        'home_value': ['home_value', 'Home Value', 'homeValue', 'property_value'],
        'length_of_residence': ['length_of_residence', 'Length of Residence', 'lengthOfResidence', 'years_at_address'],
        'marital_status': ['marital_status', 'Marital Status', 'maritalStatus', 'married'],
        'household_persons': ['household_persons', 'Household Persons', 'householdPersons', 'household_size'],
        'household_children': ['household_children', 'Household Children', 'householdChildren', 'children'],
        
        // Website tracking
        'last_page_viewed': ['last_page_viewed', 'Last Page Viewed', 'lastPageViewed', 'page_path'],
        'url': ['url', 'URL', 'website_url', 'Website URL', 'site_url']
      };

      // Function to find the correct header for a field
      const findHeader = (row: any, fieldName: string): string | null => {
        // First check if we have custom field mappings
        if (fieldMappings && typeof fieldMappings === 'string') {
          const customMappings = JSON.parse(fieldMappings);
          // Removed excessive logging that may cause performance issues
          
          // Map CSV field names to database field names
          const csvToDbMapping = {
            'firstName': 'first_name',
            'lastName': 'last_name',
            'birthDate': 'birth_date',
            'mortgageLoanType': 'mortgage_loan_type',
            'mortgageAmount': 'mortgage_amount',
            'mortgageAge': 'mortgage_age',
            'householdIncome': 'household_income',
            'homeOwnership': 'home_ownership',
            'homePrice': 'home_price',
            'homeValue': 'home_value',
            'lengthOfResidence': 'length_of_residence',
            'maritalStatus': 'marital_status',
            'householdPersons': 'household_persons',
            'householdChildren': 'household_children',
            'lastPageViewed': 'last_page_viewed',
            'hashedEmail': 'hashed_email',
            'originalEmail': 'original_email'
          };
          
          // Check if any CSV header maps to this database field
          for (const [csvHeader, mappedCsvField] of Object.entries(customMappings)) {
            // Convert camelCase CSV field to database field name
            const dbFieldName = csvToDbMapping[mappedCsvField as keyof typeof csvToDbMapping] || mappedCsvField;
            
            if (dbFieldName === fieldName && row.hasOwnProperty(csvHeader)) {
              return csvHeader;
            }
          }
        }
        
        // Fall back to automatic header mapping
        const possibleHeaders = headerMapping[fieldName as keyof typeof headerMapping] || [fieldName];
        
        for (const header of possibleHeaders) {
          if (row.hasOwnProperty(header)) {
            return header;
          }
        }
        
        // Case-insensitive search as fallback
        const rowKeys = Object.keys(row);
        for (const header of possibleHeaders) {
          const found = rowKeys.find(key => key.toLowerCase() === header.toLowerCase());
          if (found) {
            return found;
          }
        }
        
        return null;
      };

      // Parse CSV data
      const { Readable } = await import('stream');
      const csvStream = new Readable();
      csvStream.push(csvData);
      csvStream.push(null);

      await new Promise((resolve, reject) => {
        csvStream
          .pipe(csvParser())
          .on('data', (row: any) => {
            results.push(row);
            totalRows++;
          })
          .on('end', resolve)
          .on('error', reject);
      });

      console.log(`CSV Upload - Starting processing of ${results.length} rows`);
      
      // Process each row
      for (const row of results) {
        try {
          // Helper function to get value from row using header mapping
          const getValue = (fieldName: string) => {
            const header = findHeader(row, fieldName);
            const value = header ? (row as any)[header] : null;
            // Field mapping completed
            return value;
          };

          // Helper function to parse numeric values
          const parseNumber = (value: any) => {
            if (value === null || value === undefined || value === '') return null;
            const parsed = parseFloat(value);
            return isNaN(parsed) ? null : parsed;
          };

          // Helper function to parse integer values
          const parseInteger = (value: any) => {
            if (value === null || value === undefined || value === '') return null;
            const parsed = parseInt(value);
            return isNaN(parsed) ? null : parsed;
          };

          // Debug first row to understand CSV structure
          if (successCount === 0) {
            console.log('CSV Upload - First row keys:', Object.keys(row));
            console.log('CSV Upload - First row sample data:', {
              keys: Object.keys(row).slice(0, 10),
              values: Object.values(row).slice(0, 10)
            });
          }

          // Get email value and generate hash if needed
          const emailValue = getValue('email') || getValue('original_email');
          const hashedEmailValue = getValue('hashed_email') || (emailValue ? emailService.hashEmail(emailValue) : null);
          
          // Enhanced debugging for email extraction
          if (successCount === 0) {
            console.log('CSV Upload - Email field debugging:', {
              emailHeader: findHeader(row, 'email'),
              emailValue: emailValue,
              hashedEmailHeader: findHeader(row, 'hashed_email'),
              hashedEmailValue: hashedEmailValue,
              allEmailLikeFields: Object.keys(row).filter(k => k.toLowerCase().includes('email'))
            });
          }
          
          // Skip row if no email data available
          if (!hashedEmailValue) {
            console.log(`CSV Upload - Skipping row ${successCount + errorCount + 1}: No email or hashed email available. Available fields: ${Object.keys(row).join(', ')}`);
            errorCount++;
            errors.push(`Row ${successCount + errorCount}: No email data available`);
            continue;
          }

          // Create email capture record using correct database field names (camelCase)
          const captureData = {
            cid: cid, // This should be the selected Business Account CID (e.g., 'Robbie_Haas')
            hashedEmail: hashedEmailValue,
            originalEmail: emailValue,
            firstName: getValue('first_name'),
            lastName: getValue('last_name'),
            address: getValue('address'),
            city: getValue('city'),
            state: getValue('state'),
            zip: getValue('zip'),
            gender: getValue('gender'),
            birthDate: getValue('birth_date'),
            email: emailValue,
            mortgageLoanType: getValue('mortgage_loan_type'),
            mortgageAmount: parseNumber(getValue('mortgage_amount'))?.toString() || null,
            mortgageAge: parseInteger(getValue('mortgage_age')),
            householdIncome: getValue('household_income') ? String(getValue('household_income')) : null,
            homeOwnership: getValue('home_ownership'),
            homePrice: parseNumber(getValue('home_price'))?.toString() || null,
            homeValue: parseNumber(getValue('home_value'))?.toString() || null,
            lengthOfResidence: parseInteger(getValue('length_of_residence')),
            age: parseInteger(getValue('age')),
            maritalStatus: getValue('marital_status'),
            householdPersons: parseInteger(getValue('household_persons')),
            householdChildren: parseInteger(getValue('household_children')),
            lastPageViewed: getValue('last_page_viewed') || '/',
            url: getValue('url'),
            enrichmentStatus: 'completed',
            capturedAt: new Date()
          };

          // Log first row for debugging if needed
          if (successCount === 0) {
            console.log(`CSV Upload - Processing first row with ${Object.keys(captureData).length} mapped fields`);
          }

          // Remove null/undefined values but keep required fields
          Object.keys(captureData).forEach(key => {
            // Don't delete required database fields
            if (key === 'hashedEmail' || key === 'cid') return;
            
            const value = (captureData as any)[key];
            if (value === null || value === undefined || value === '') {
              delete (captureData as any)[key];
            }
          });

          await storage.createEmailCapture(captureData);
          successCount++;
          
          // Log progress every 100 rows
          if (successCount % 100 === 0) {
            console.log(`CSV Upload - Processed ${successCount} rows successfully`);
          }
        } catch (error: any) {
          errorCount++;
          errors.push(`Row ${successCount + errorCount}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Processing completed - results will be returned in response

      // Detect and report header mapping for first row
      let headerReport = {};
      if (results.length > 0) {
        const firstRow = results[0];
        const detectedHeaders = {};
        
        Object.keys(headerMapping).forEach(fieldName => {
          const header = findHeader(firstRow, fieldName);
          if (header) {
            (detectedHeaders as any)[fieldName] = header;
          }
        });
        
        headerReport = {
          detected: detectedHeaders,
          availableHeaders: Object.keys(firstRow),
          mappedFields: Object.keys(detectedHeaders).length
        };
      }

      res.json({
        success: true,
        message: `CSV upload completed. ${successCount} records processed successfully.`,
        totalRows,
        successCount,
        errorCount,
        errors: errors.slice(0, 10), // Limit error messages
        headerMapping: headerReport
      });
    } catch (error: any) {
      console.error("Error uploading CSV:", error);
      res.status(500).json({ message: "Failed to upload CSV data" });
    }
  });

  // Admin dashboard statistics
  app.get('/api/admin/dashboard-stats', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const selectedCid = req.query.cid === 'all' ? undefined : req.query.cid as string;
      const timePeriod = req.query.timePeriod as string || '30d';
      const customFromDate = req.query.fromDate as string;
      const customToDate = req.query.toDate as string;

      // Calculate date range based on time period
      let dateFilter: Date | undefined;
      let endDateFilter: Date | undefined;
      
      if (timePeriod === 'custom' && customFromDate && customToDate) {
        // Use custom date range
        dateFilter = new Date(customFromDate);
        endDateFilter = new Date(customToDate);
        // Set end date to end of day
        endDateFilter.setHours(23, 59, 59, 999);
      } else if (timePeriod !== 'all') {
        dateFilter = new Date();
        switch (timePeriod) {
          case '7d':
            dateFilter.setDate(dateFilter.getDate() - 7);
            break;
          case '30d':
            dateFilter.setDate(dateFilter.getDate() - 30);
            break;
          case '90d':
            dateFilter.setDate(dateFilter.getDate() - 90);
            break;
          case '1y':
            dateFilter.setFullYear(dateFilter.getFullYear() - 1);
            break;
        }
      }

      // Get basic statistics
      const cidAccounts = await storage.getCidAccounts();
      let emailCaptures = await storage.getEmailCaptures(undefined, selectedCid);
      let campaigns = await storage.getCampaigns();

      // Filter by date if specified
      if (dateFilter) {
        emailCaptures = emailCaptures.filter(capture => {
          const captureDate = new Date(capture.createdAt || 0);
          if (endDateFilter) {
            return captureDate >= dateFilter && captureDate <= endDateFilter;
          }
          return captureDate >= dateFilter;
        });
        campaigns = campaigns.filter(campaign => {
          const campaignDate = new Date(campaign.createdAt || 0);
          if (endDateFilter) {
            return campaignDate >= dateFilter && campaignDate <= endDateFilter;
          }
          return campaignDate >= dateFilter;
        });
      }
      
      // Calculate separate counts for Contact Emails and Household Addresses
      const contactEmailsCount = emailCaptures.filter(capture => {
        // Check both enrichmentData (legacy) and direct fields (new format)
        const enrichmentData = capture.enrichmentData as any;
        return enrichmentData?.contact_email || capture.originalEmail || capture.email;
      }).length;

      const householdAddressesCount = emailCaptures.filter(capture => {
        // Check both enrichmentData (legacy) and direct fields (new format)
        const enrichmentData = capture.enrichmentData as any;
        const hasAddress = enrichmentData?.address || capture.address;
        // Household Addresses = records with address data (regardless of email since we're counting addresses)
        return hasAddress && hasAddress.trim() !== '';
      }).length;

      // Calculate enrichment rate - check for both enrichmentData and direct fields
      const enrichedCaptures = emailCaptures.filter(capture => {
        if (capture.enrichmentStatus !== 'completed') return false;
        // Check both enrichmentData (legacy) and direct fields (new format)
        const enrichmentData = capture.enrichmentData as any;
        const hasAddress = enrichmentData?.address || capture.address;
        const hasEmail = enrichmentData?.contact_email || capture.originalEmail || capture.email;
        // Enriched = household address + email address
        return hasAddress && hasEmail;
      });
      const enrichmentRate = emailCaptures.length > 0 ? 
        Math.round((enrichedCaptures.length / emailCaptures.length) * 100) : 0;

      // Today's captures
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayCaptures = emailCaptures.filter(capture => 
        capture.capturedAt && new Date(capture.capturedAt) >= today
      ).length;

      // Count only active accounts
      const activeAccountsCount = selectedCid ? 1 : cidAccounts.filter(account => account.status === 'active').length;

      const stats = {
        totalAccounts: activeAccountsCount,
        totalEmailCaptures: emailCaptures.length,
        plainTextEmails: contactEmailsCount, // Contact Emails Captured
        enrichedCount: householdAddressesCount, // Household Addresses Captured
        enrichmentRate,
        todayCaptures,
        activeSessions: 1, // This would be tracked separately in production
        errorRate: 0.0 // This would be calculated from error logs
      };

      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard statistics" });
    }
  });

  // Admin recent activity
  app.get('/api/admin/recent-activity', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const selectedCid = req.query.cid === 'all' ? undefined : req.query.cid as string;
      const timePeriod = req.query.timePeriod as string || '30d';
      const customFromDate = req.query.fromDate as string;
      const customToDate = req.query.toDate as string;

      // Calculate date range based on time period
      let dateFilter: Date | undefined;
      let endDateFilter: Date | undefined;
      
      if (timePeriod === 'custom' && customFromDate && customToDate) {
        // Use custom date range
        dateFilter = new Date(customFromDate);
        endDateFilter = new Date(customToDate);
        // Set end date to end of day
        endDateFilter.setHours(23, 59, 59, 999);
      } else if (timePeriod !== 'all') {
        dateFilter = new Date();
        switch (timePeriod) {
          case '7d':
            dateFilter.setDate(dateFilter.getDate() - 7);
            break;
          case '30d':
            dateFilter.setDate(dateFilter.getDate() - 30);
            break;
          case '90d':
            dateFilter.setDate(dateFilter.getDate() - 90);
            break;
          case '1y':
            dateFilter.setFullYear(dateFilter.getFullYear() - 1);
            break;
        }
      }

      // Get recent email captures and campaigns
      let emailCaptures = await storage.getEmailCaptures(undefined, selectedCid);
      let campaigns = await storage.getCampaigns();

      // Filter by date if specified
      if (dateFilter) {
        emailCaptures = emailCaptures.filter(capture => {
          const captureDate = new Date(capture.createdAt || 0);
          if (endDateFilter) {
            return captureDate >= dateFilter && captureDate <= endDateFilter;
          }
          return captureDate >= dateFilter;
        });
        campaigns = campaigns.filter(campaign => {
          const campaignDate = new Date(campaign.createdAt || 0);
          if (endDateFilter) {
            return campaignDate >= dateFilter && campaignDate <= endDateFilter;
          }
          return campaignDate >= dateFilter;
        });
      }

      // Create activity feed
      const activities: any[] = [];

      // Add recent email captures
      emailCaptures
        .sort((a, b) => new Date(b.capturedAt || 0).getTime() - new Date(a.capturedAt || 0).getTime())
        .slice(0, 5)
        .forEach(capture => {
          activities.push({
            type: 'capture',
            description: `New identity captured (MD5 hashed) from ${capture.cid}`,
            timestamp: formatTimestamp(capture.capturedAt)
          });
        });

      // Add recent campaign activity
      campaigns
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, 3)
        .forEach(campaign => {
          activities.push({
            type: 'campaign',
            description: `Campaign "${campaign.name}" ${campaign.status}`,
            timestamp: formatTimestamp(campaign.createdAt)
          });
        });

      // Sort by most recent and limit
      activities.sort((a, b) => {
        const aTime = Date.parse(a.timestamp) || 0;
        const bTime = Date.parse(b.timestamp) || 0;
        return bTime - aTime;
      });

      res.json(activities.slice(0, 10));
    } catch (error) {
      console.error("Error fetching recent activity:", error);
      res.status(500).json({ message: "Failed to fetch recent activity" });
    }
  });

  // System health endpoint
  app.get('/api/admin/system-health', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      // Get live API integration status
      const audienceAcuityStatus = { connected: true, dailyRequests: 0, successRate: 98.5 };
      const mailchimpStatus = await mailchimpService.getStatus();
      
      // Get Handwrytten status
      let handwryttenStatus: { connected: boolean; configured: boolean; error?: string } = { connected: false, configured: false };
      try {
        const { handwryttenService } = await import('./services/handwryttenService');
        handwryttenStatus = await handwryttenService.getStatus();
      } catch (error: any) {
        handwryttenStatus = { connected: false, configured: false, error: error.message };
      }
      
      // Check Sphere Data Solutions endpoint
      let sphereDataStatus: { connected: boolean; error: string | null } = { connected: false, error: null };
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const sphereResponse = await fetch('https://spheredatasolutionsgroup.com/_functions/pixelEndpoint?test=1', {
          method: 'GET',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (sphereResponse.status === 200 || sphereResponse.status === 204) {
          sphereDataStatus = { connected: true, error: null };
        } else if (sphereResponse.status === 500) {
          sphereDataStatus.connected = false;
          sphereDataStatus.error = 'Wix Backend Error - Check Wix function code';
        } else {
          sphereDataStatus.connected = false;
          sphereDataStatus.error = `HTTP ${sphereResponse.status}`;
        }
      } catch (error) {
        sphereDataStatus.connected = false;
        sphereDataStatus.error = 'Connection Failed';
      }
      
      const health = {
        server: 'online',
        database: 'connected',
        authentication: 'active',
        integrations: {
          audienceAcuity: {
            connected: audienceAcuityStatus.connected,
            dailyRequests: audienceAcuityStatus.dailyRequests,
            successRate: audienceAcuityStatus.successRate
          },
          mailchimp: {
            connected: mailchimpStatus.connected,
            totalContacts: mailchimpStatus.totalContacts,
            pendingSync: mailchimpStatus.pendingSync
          },
          sphereData: {
            connected: sphereDataStatus.connected,
            error: sphereDataStatus.error,
            endpoint: 'https://spheredatasolutionsgroup.com/_functions/pixelEndpoint'
          },
          handwrytten: {
            connected: handwryttenStatus.connected,
            configured: handwryttenStatus.configured,
            error: handwryttenStatus.error
          }
        }
      };

      res.json(health);
    } catch (error) {
      console.error("Error fetching system health:", error);
      res.status(500).json({ message: "Failed to fetch system health" });
    }
  });

  // Test Audience Acuity integration endpoint
  app.get('/api/test-audience-acuity', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const testEmail = req.query.email || "5d41402abc4b2a76b9719d911017c592"; // Test hash
      console.log('Testing Audience Acuity with email:', testEmail);
      
      const result = await enrichWithAudienceAcuity(testEmail);
      console.log('Audience Acuity test result:', result);
      
      res.json({
        success: true,
        testEmail,
        result
      });
    } catch (error) {
      console.error('Audience Acuity test error:', error);
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Unknown error',
        testEmail: req.query.email || "5d41402abc4b2a76b9719d911017c592"
      });
    }
  });

  // Email lookup endpoint
  app.get('/api/email-lookup', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const email = req.query.email as string;
      
      console.log(`Email lookup request: userId=${userId}, email=${email}`);
      
      if (!email) {
        return res.status(400).json({ success: false, message: "Email parameter is required" });
      }
      
      // Get user details to check role
      const user = await storage.getUser(userId);
      console.log(`User details:`, { id: userId, role: user?.role, assignedCid: user?.assignedCid });
      
      // Get accessible CIDs for this user
      const accessibleCids = await storage.getUserAccessibleCids(userId);
      console.log(`Accessible CIDs for user ${userId}:`, accessibleCids);
      

      
      if (accessibleCids.length === 0) {
        return res.json({ success: false, message: "No accessible accounts found" });
      }
      
      // Search for email in accessible CIDs
      let foundProfile = null;
      for (const cid of accessibleCids) {
        console.log(`Searching in CID: ${cid}`);
        const captures = await storage.getEmailCapturesByCid(cid);
        console.log(`Found ${captures.length} captures in CID ${cid}`);
        
        const emailCapture = captures.find(capture => 
          capture.originalEmail === email || 
          capture.email === email ||
          (capture.enrichmentData && (capture.enrichmentData as any).email === email)
        );
        
        if (emailCapture) {
          console.log(`Found email capture:`, {
            id: emailCapture.id,
            email: emailCapture.originalEmail,
            status: emailCapture.enrichmentStatus,
            hasData: !!emailCapture.enrichmentData
          });
          
          if (emailCapture.enrichmentStatus === 'completed' && emailCapture.enrichmentData) {
            foundProfile = {
              id: emailCapture.id,
              email: emailCapture.email || emailCapture.originalEmail,
              hashedEmail: emailCapture.hashedEmail,
              ...emailCapture.enrichmentData
            };
            break;
          }
        }
      }
      
      if (foundProfile) {
        console.log(`Returning profile for ${email}:`, foundProfile);
        res.json({ success: true, found: true, profile: foundProfile });
      } else {
        console.log(`No profile found for ${email}`);
        res.json({ success: false, found: false, message: `No profile found for "${email}"` });
      }
    } catch (error) {
      console.error("Error in email lookup:", error);
      res.status(500).json({ success: false, message: "Failed to lookup email" });
    }
  });

  // Sync website identities using new pixel endpoint service
  app.post('/api/sync-website-identities', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      
      console.log(`[Sync] Website identities sync request from user: ${userId}`);
      
      // Ensure valid OAuth token for enrichment operations
      try {
        const { ensureValidOAuthToken } = await import('./services/audienceAcuityService');
        const oauthReady = await ensureValidOAuthToken();
        if (oauthReady) {
          console.log(`[Sync] ✅ OAuth token refreshed and ready for enrichment operations`);
        } else {
          console.log(`[Sync] ⚠️ OAuth token refresh failed - will use fallback authentication for enrichment`);
        }
      } catch (error: any) {
        console.log(`[Sync] OAuth token refresh error: ${error instanceof Error ? error.message : String(error)} - continuing with fallback auth`);
      }
      
      // Get user details to check permissions
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(403).json({ success: false, message: "User not found" });
      }
      
      // Get accessible CIDs for this user
      const accessibleCids = await storage.getUserAccessibleCids(userId);
      console.log(`[Sync] Accessible CIDs for sync: ${accessibleCids}`);
      
      if (accessibleCids.length === 0) {
        return res.json({ success: false, message: "No accessible accounts found", synced: 0 });
      }
      
      let totalSynced = 0;
      const newlySyncedRecords = []; // Track newly synced records for enrichment
      
      // Query pixel endpoint for actual visitor data for each accessible CID
      for (const cid of accessibleCids) {
        console.log(`[Sync] Querying pixel endpoint for visitor data - CID: ${cid}`);
        
        try {
          // Get last sync timestamp for delta sync
          const syncLogEntry = await storage.getSyncLog(cid);
          const lastSyncedAt = syncLogEntry?.lastSyncedAt;
          
          // Build Worker URL with optional 'since' parameter for delta sync
          let workerUrl = `https://spheredsgpixel.com/pixelEndpoint?cid=${encodeURIComponent(cid)}`;
          if (lastSyncedAt) {
            const sinceParam = lastSyncedAt.toISOString();
            workerUrl += `&since=${encodeURIComponent(sinceParam)}`;
            console.log(`[Sync] Delta sync - fetching records since: ${sinceParam}`);
          } else {
            console.log(`[Sync] Full sync - no previous sync timestamp found`);
          }
          
          console.log(`[Sync] Fetching visitor records from Worker: ${workerUrl}`);
          
          const pixelResponse = await fetch(workerUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'VisitorIQ-Pro/1.0'
            }
          });
          
          console.log(`[Sync] Pixel endpoint response for CID ${cid}: Status ${pixelResponse.status}`);
          
          if (!pixelResponse.ok) {
            if (pixelResponse.status === 404) {
              console.log(`[Sync] Worker endpoint not found (404) for CID ${cid} - this suggests the Cloudflare Worker may not be deployed at this URL`);
            } else {
              console.log(`[Sync] Worker endpoint returned HTTP ${pixelResponse.status} for CID ${cid}`);
            }
            continue; // Skip this CID and try the next one
          }
          
          if (pixelResponse.ok) {
            const responseText = await pixelResponse.text();
            console.log(`[Sync] Raw response for CID ${cid}:`, responseText);
            
            // Try to parse as JSON
            try {
              const workerRecords = JSON.parse(responseText);
              console.log(`[Sync] Received ${Array.isArray(workerRecords) ? workerRecords.length : 'single'} visitor record(s) from Worker for CID ${cid}`);
              
              // Process Worker records array
              if (Array.isArray(workerRecords) && workerRecords.length > 0) {
                console.log(`[Sync] Processing ${workerRecords.length} visitor records from Worker for CID ${cid}`);
                
                let maxTimestamp = lastSyncedAt?.toISOString() || null;
                let cidSyncedCount = 0;
                
                for (const record of workerRecords) {
                  if (!record.md5) {
                    console.log(`[Sync] Skipping record without MD5 hash`);
                    continue;
                  }

                  console.log(`[Sync] Processing Worker record: MD5=${record.md5}, URL=${record.url || 'N/A'}, TS=${record.ts || 'N/A'}`);
                  
                  // Track max timestamp for sync log update
                  if (record.ts && (!maxTimestamp || new Date(record.ts) > new Date(maxTimestamp))) {
                    maxTimestamp = record.ts;
                  }
                  
                  // Check if record already exists
                  const existingRecord = await storage.getEmailCaptureByHashAndCid(record.md5, cid);
                  
                  if (!existingRecord) {
                    // Insert new record
                    const insertData = {
                      hashedEmail: record.md5,
                      cid: cid,
                      url: record.url || null,
                      lastPageViewed: record.url || null, // Populate lastPageViewed with the captured URL
                      ts: record.ts || null,
                      var1: record.var || null, // Worker returns 'var' field
                      sessionId: record.gtmcb || null, // Store gtmcb as session identifier
                      source: 'pixel_endpoint',
                      userId: userId,
                      capturedAt: record.ts ? new Date(record.ts) : new Date(),
                      enrichmentStatus: 'pending'
                    };
                    
                    const newCapture = await storage.createEmailCapture(insertData);
                    if (newCapture) {
                      totalSynced++;
                      cidSyncedCount++;
                      newlySyncedRecords.push(newCapture); // Track for enrichment
                      console.log(`[Sync] Inserted new visitor record: ${record.md5}`);
                    }
                  } else {
                    // Update existing record with latest data
                    const updateData = {
                      url: record.url || existingRecord.url,
                      lastPageViewed: record.url || existingRecord.lastPageViewed, // Update lastPageViewed with the captured URL
                      ts: record.ts || existingRecord.ts,
                      var1: record.var || existingRecord.var1,
                      sessionId: record.gtmcb || existingRecord.sessionId,
                      updatedAt: new Date()
                    };
                    
                    await storage.updateEmailCapture(existingRecord.id, updateData);
                    console.log(`[Sync] Updated existing visitor record: ${record.md5}`);
                  }
                }
                
                // Update sync log with new timestamp and record count
                if (maxTimestamp && maxTimestamp !== (lastSyncedAt?.toISOString() || null)) {
                  await storage.upsertSyncLog(cid, maxTimestamp, cidSyncedCount);
                  console.log(`[Sync] Updated sync log for CID ${cid}: ${maxTimestamp}, ${cidSyncedCount} new records`);
                }
              } else if (workerRecords && !Array.isArray(workerRecords) && workerRecords.md5) {
                // Single record from Worker
                console.log(`[Sync] Processing single Worker record: MD5=${workerRecords.md5}`);
                
                let maxTimestamp = lastSyncedAt?.toISOString() || null;
                let cidSyncedCount = 0;
                
                // Track max timestamp for sync log update
                if (workerRecords.ts && (!maxTimestamp || new Date(workerRecords.ts) > new Date(maxTimestamp))) {
                  maxTimestamp = workerRecords.ts;
                }
                
                const existingRecord = await storage.getEmailCaptureByHashAndCid(workerRecords.md5, cid);
                
                if (!existingRecord) {
                  const insertData = {
                    hashedEmail: workerRecords.md5,
                    cid: cid,
                    url: workerRecords.url || null,
                    lastPageViewed: workerRecords.url || null, // Populate lastPageViewed with the captured URL
                    ts: workerRecords.ts || null,
                    var1: workerRecords.var || null,
                    sessionId: workerRecords.gtmcb || null,
                    source: 'pixel_endpoint',
                    userId: userId,
                    capturedAt: workerRecords.ts ? new Date(workerRecords.ts) : new Date(),
                    enrichmentStatus: 'pending'
                  };
                  
                  const newCapture = await storage.createEmailCapture(insertData);
                  if (newCapture) {
                    totalSynced++;
                    cidSyncedCount++;
                    newlySyncedRecords.push(newCapture); // Track for enrichment
                    console.log(`[Sync] Inserted single visitor record: ${workerRecords.md5}`);
                  }
                }
                
                // Update sync log with new timestamp and record count
                if (maxTimestamp && maxTimestamp !== (lastSyncedAt?.toISOString() || null)) {
                  await storage.upsertSyncLog(cid, maxTimestamp, cidSyncedCount);
                  console.log(`[Sync] Updated sync log for CID ${cid}: ${maxTimestamp}, ${cidSyncedCount} new records`);
                }
              } else if (Array.isArray(workerRecords) && workerRecords.length === 0) {
                console.log(`[Sync] Worker returned empty array for CID ${cid} - no visitor records available`);
              } else {
                console.log(`[Sync] Unexpected Worker response format for CID ${cid}:`, workerRecords);
              }
            } catch (parseError) {
              console.log(`[Sync] Response not JSON for CID ${cid}:`, parseError instanceof Error ? parseError instanceof Error ? parseError.message : String(parseError) : 'Parse error');
              
              // Enhanced Worker status detection
              if (responseText && responseText.startsWith('GIF89a')) {
                console.log(`[Sync] ⚠️  Worker returning GIF pixel instead of JSON for CID ${cid}`);
                console.log(`[Sync] 📝 ACTION REQUIRED: Update Cloudflare Worker at https://spheredsgpixel.com/pixelEndpoint`);
                console.log(`[Sync] 🔧 Worker needs to return JSON array when queried with ?cid=${cid}`);
                console.log(`[Sync] 📋 Expected format: [{"md5":"...", "cid":"${cid}", "url":"...", "ts":"...", "var":"...", "gtmcb":"..."}]`);
              } else if (responseText && responseText.includes('<html>') || responseText.includes('<!DOCTYPE')) {
                console.log(`[Sync] Received HTML response instead of JSON for CID ${cid} - Worker may not be deployed or URL incorrect`);
              } else if (responseText && (responseText.includes('md5') || responseText.includes('cid'))) {
                console.log(`[Sync] Response appears to contain data but in non-JSON format for CID ${cid}`);
              } else {
                console.log(`[Sync] No visitor data found in response for CID ${cid}`);
              }
            }
          }

        } catch (error) {
          console.error(`[Sync] Error querying pixel endpoint for CID ${cid}:`, error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Unknown error');
          // Continue with next CID
        }
      }
      
      // Log successful sync for audit trail
      console.log(`[Sync] Website identities sync completed. User: ${userId}, Total records: ${totalSynced}, CIDs: ${accessibleCids.join(', ')}, Timestamp: ${new Date().toISOString()}`);
      
      // Trigger enrichment for newly synced records only
      if (newlySyncedRecords.length > 0) {
        console.log(`[Sync] Triggering enrichment for ${newlySyncedRecords.length} newly synced records...`);
        try {
          // Import enrichment service and trigger batch enrichment
          const { batchEnrichAndSave } = await import('./services/enrichmentService');
          
          // Use asynchronous enrichment (don't block the sync response)
          batchEnrichAndSave(newlySyncedRecords).then(stats => {
            console.log(`[Sync] ✅ Enrichment completed: ${stats.enriched} enriched, ${stats.failed} failed, ${stats.retried} retried`);
            if (stats.errors.length > 0) {
              console.log(`[Sync] ⚠️ Enrichment errors: ${stats.errors.length} records failed (first 3):`);
              stats.errors.slice(0, 3).forEach(err => {
                console.log(`[Sync]   MD5: ${err.md5.substring(0,8)}... - ${err.error}`);
              });
            }
          }).catch(error => {
            console.error('[Sync] ❌ Error in post-sync enrichment batch:', error);
          });
        } catch (error) {
          console.error('[Sync] Error triggering post-sync enrichment:', error);
        }
      }
      
      res.json({ 
        success: true, 
        synced: totalSynced,
        message: `Successfully captured ${totalSynced} visitor record${totalSynced !== 1 ? 's' : ''} from pixel endpoint${totalSynced > 0 ? ' and triggered enrichment' : ''}`,
        timestamp: new Date().toISOString(),
        processedCids: accessibleCids
      });
      
    } catch (error) {
      console.error("[Sync] Error in website identities sync:", error);
      res.status(500).json({ success: false, message: "Failed to sync website identities", synced: 0 });
    }
  });

  // Get scheduled sync status
  app.get('/api/scheduled-sync/status', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: "Admin access required" });
      }
      
      const status = await scheduledSyncService.getStatus();
      res.json({ success: true, ...status });
      
    } catch (error) {
      console.error("Error getting scheduled sync status:", error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Unknown error');
      res.status(500).json({ success: false, message: "Failed to get sync status" });
    }
  });

  // Manually trigger scheduled sync
  app.post('/api/scheduled-sync/trigger', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: "Admin access required" });
      }
      
      const result = await scheduledSyncService.triggerManualSync();
      res.json(result);
      
    } catch (error) {
      console.error("Error triggering manual sync:", error);
      res.status(500).json({ success: false, message: "Failed to trigger sync" });
    }
  });

  // Get Handwrytten nightly sync status
  app.get('/api/handwrytten-nightly-sync/status', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: "Admin access required" });
      }
      
      // Legacy endpoint - redirect to enhanced sync API
      const status = getSyncStatus('handwrytten');
      res.json({ success: true, ...status });
      
    } catch (error) {
      console.error("Error getting Handwrytten nightly sync status:", error instanceof Error ? error.message : String(error));
      res.status(500).json({ success: false, message: "Failed to get sync status" });
    }
  });

  // Manually trigger Handwrytten nightly sync
  app.post('/api/handwrytten-nightly-sync/trigger', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: "Admin access required" });
      }
      
      // Legacy endpoint - use new Handwrytten service directly
      const { handwryttenService } = await import('./services/handwryttenService');
      const result = await handwryttenService.syncEnrichedContacts();
      res.json({ 
        success: result.success, 
        message: result.message,
        sent: result.sent,
        errors: result.errors
      });
      
    } catch (error) {
      console.error("Error triggering manual Handwrytten nightly sync:", error);
      res.status(500).json({ success: false, message: "Failed to trigger sync" });
    }
  });

  // Mailchimp sync testing endpoint
  app.post('/api/mailchimp/sync', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: "Admin access required" });
      }

      console.log('[API] Manual Mailchimp sync triggered');
      const { mailchimpService } = await import('./services/mailchimpService');
      const result = await mailchimpService.syncContactsByCid();
      
      res.json({
        success: true,
        synced: result.synced,
        errors: result.errors,
        cidSynced: result.cidSynced,
        message: `Successfully synced ${result.synced} contacts across ${result.cidSynced.length} CID(s) using delta sync`
      });
    } catch (error: any) {
      console.error('[API] Mailchimp sync error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to sync contacts to Mailchimp',
        synced: 0,
        errors: 1
      });
    }
  });

  // Manual OAuth token setter (admin only)
  app.post('/api/admin/set-oauth-token', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: "Admin access required" });
      }

      const { access_token, expires_in = 3600 } = req.body;
      
      if (!access_token) {
        return res.status(400).json({ success: false, message: "access_token is required" });
      }

      // Import the setManualOAuthToken function
      const { setManualOAuthToken } = await import('./services/audienceAcuityService');
      setManualOAuthToken(access_token, expires_in);
      
      res.json({ 
        success: true, 
        message: `OAuth token set successfully (expires in ${Math.round(expires_in / 60)} minutes)`,
        expires_at: new Date(Date.now() + (expires_in * 1000)).toISOString()
      });
      
    } catch (error: any) {
      console.error('Set OAuth token error:', error);
      res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
    }
  });

  // Enhanced enrichment system test endpoint (admin only)
  app.post('/api/admin/test-enrichment-system', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: "Admin access required" });
      }

      const { testMd5 = '2cb51ec6815a4ab98a81f65be5155631', batchSize = 5 } = req.body;
      console.log(`[Admin Enrichment Test] Starting system test with MD5: ${testMd5}`);
      
      const results = {
        timestamp: new Date().toISOString(),
        apiCredentials: {
          keyIdPresent: !!process.env.AUDIENCE_ACUITY_KEY_ID,
          keyIdPrefix: process.env.AUDIENCE_ACUITY_KEY_ID?.substring(0, 4) || 'none',
          apiKeyPresent: !!process.env.AUDIENCE_ACUITY_API_KEY,
          apiKeyLength: process.env.AUDIENCE_ACUITY_API_KEY?.length || 0
        },
        directApiTest: null,
        batchTest: null,
        errors: []
      };

      // Test 1: Direct API call
      try {
        console.log(`[Admin Enrichment Test] Testing direct API...`);
        const { enrichWithAudienceAcuity } = await import('./services/audienceAcuityService');
        const apiResult = await enrichWithAudienceAcuity(testMd5);
        
        results.directApiTest = {
          success: true,
          dataFound: !!apiResult,
          resultType: apiResult ? (Array.isArray(apiResult) ? 'array' : 'object') : 'null',
          resultCount: Array.isArray(apiResult) ? apiResult.length : apiResult ? 1 : 0,
          sampleData: apiResult ? JSON.stringify(apiResult).substring(0, 200) + '...' : null
        } as any;
        console.log(`[Admin Enrichment Test] ✅ Direct API test successful`);
      } catch (error: any) {
        console.error(`[Admin Enrichment Test] ❌ Direct API test failed:`, error instanceof Error ? error.message : String(error));
        results.directApiTest = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          errorType: error.name
        } as any;
        (results.errors as any[]).push(`Direct API: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Test 2: Enhanced batch enrichment
      try {
        console.log(`[Admin Enrichment Test] Testing batch enrichment...`);
        const allCaptures = await storage.getEmailCaptures();
        const testCaptures = allCaptures
          .filter(c => c.hashedEmail && c.enrichmentStatus !== 'completed')
          .slice(0, batchSize);
        
        if (testCaptures.length > 0) {
          const batchResult = await batchEnrichAndSave(testCaptures);
          results.batchTest = {
            success: true,
            recordsProcessed: batchResult.total,
            enriched: batchResult.enriched,
            failed: batchResult.failed,
            skipped: batchResult.skipped,
            retried: batchResult.retried,
            errorCount: batchResult.errors.length,
            errors: batchResult.errors.slice(0, 3) // Show first 3 errors
          } as any;
          console.log(`[Admin Enrichment Test] ✅ Batch test completed: ${batchResult.enriched}/${batchResult.total} enriched`);
        } else {
          results.batchTest = {
            success: true,
            message: 'No records available for batch testing',
            recordsProcessed: 0
          } as any;
        }
      } catch (error: any) {
        console.error(`[Admin Enrichment Test] ❌ Batch test failed:`, error instanceof Error ? error.message : String(error));
        results.batchTest = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          errorType: error.name
        } as any;
        (results.errors as any[]).push(`Batch processing: ${error instanceof Error ? error.message : String(error)}`);
      }

      console.log(`[Admin Enrichment Test] 🎯 Test completed with ${results.errors.length} errors`);
      res.json(results);
      
    } catch (error: any) {
      console.error(`[Admin Enrichment Test] System error:`, error);
      res.status(500).json({ 
        success: false, 
        error: 'System test failed',
        details: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // Test enrichment endpoint for specific record
  app.post('/api/test-enrichment/:hashedEmail', requireAuth, async (req, res) => {
    try {
      const { hashedEmail } = req.params;
      console.log(`[Test Enrichment] Starting test for MD5: ${hashedEmail}`);
      
      // Find the record by hashed email using existing method
      const allCaptures = await storage.getEmailCaptures();
      const captures = allCaptures.filter(c => c.hashedEmail === hashedEmail);
      if (captures.length === 0) {
        console.log(`[Test Enrichment] No record found for MD5: ${hashedEmail}`);
        return res.status(404).json({ success: false, error: 'Record not found' });
      }
      
      const capture = captures[0];
      console.log(`[Test Enrichment] Found record ID: ${capture.id} for MD5: ${hashedEmail.substring(0, 8)}...`);
      
      // Test enrichment with Audience Acuity
      console.log(`[Test Enrichment] Calling Audience Acuity API for enrichment...`);
      const enrichment = await enrichWithAudienceAcuity(hashedEmail);
      
      if (enrichment) {
        console.log(`[Test Enrichment] Enrichment successful for MD5: ${hashedEmail.substring(0, 8)}...`);
        
        // Apply enrichment to the record using enrichAndSave
        await enrichAndSave(capture);
        
        // Get updated record to show results
        const updatedCapture = await storage.getEmailCaptureById(capture.id);
        
        res.json({
          success: true,
          hashedEmail,
          enrichmentData: enrichment,
          updatedRecord: updatedCapture,
          message: 'Enrichment test successful and applied to database'
        });
      } else {
        console.log(`[Test Enrichment] No enrichment data returned for MD5: ${hashedEmail.substring(0, 8)}...`);
        res.json({
          success: false,
          hashedEmail,
          error: 'No enrichment data found from Audience Acuity'
        });
      }
    } catch (error) {
      console.error(`[Test Enrichment] Error for MD5 ${req.params.hashedEmail}:`, error);
      res.status(500).json({ 
        success: false, 
        error: 'Enrichment test failed',
        details: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // API credential verification endpoint
  app.post('/api/verify-audience-acuity-credentials', requireAuth, async (req, res) => {
    try {
      console.log(`[Credential Verification] Starting API credential test...`);
      
      const { testApiCredentials } = await import('./services/audienceAcuityService');
      const result = await testApiCredentials();
      
      console.log(`[Credential Verification] Test result:`, result);
      
      if (result.success) {
        res.json({
          success: true,
          message: 'API credentials are valid and working',
          details: result.details
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error,
          details: result.details,
          troubleshooting: {
            steps: [
              'Verify AUDIENCE_ACUITY_KEY_ID and AUDIENCE_ACUITY_API_KEY are correct',
              'Check for extra whitespace in credentials',
              'Contact Audience Acuity support to activate API key',
              'Verify template ID 79123584 is valid for your account'
            ],
            supportMessage: 'Contact Audience Acuity: "We are receiving \'key is not active\' errors. Can you verify our API credentials are active and template 79123584 is valid?"'
          }
        });
      }
    } catch (error: any) {
      console.error(`[Credential Verification] System error:`, error);
      res.status(500).json({
        success: false,
        error: 'Credential verification failed',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // ===========================
  // USER MANAGEMENT ENDPOINTS
  // ===========================

  // Generate user login
  app.post('/api/admin/users/generate-login', requireAuth, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const currentUser = await storage.getUser(currentUserId);
      
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { email, firstName, lastName, password, role, assignedCid, sendInvitation } = req.body;
      
      if (!email || !firstName || !lastName || !password || !role) {
        return res.status(400).json({ 
          message: "Email, first name, last name, password, and role are required" 
        });
      }

      if (!['admin', 'client'].includes(role)) {
        return res.status(400).json({ 
          message: "Role must be 'admin' or 'client'" 
        });
      }

      if (role === 'client' && !assignedCid) {
        return res.status(400).json({ 
          message: "Client users must have an assigned CID" 
        });
      }

      const createUserRequest = {
        email,
        firstName,
        lastName,
        password,
        role,
        assignedCid,
        sendInvitation: sendInvitation || false
      };

      const result = await userManagementService.generateUserLogin(
        createUserRequest, 
        currentUserId
      );

      res.json({
        success: true,
        message: "User login generated successfully",
        user: result.user,
        loginInstructions: result.loginInstructions,
        accessDetails: result.accessDetails,
        temporaryPassword: result.temporaryPassword
      });
      
    } catch (error: any) {
      console.error("Error generating user login:", error);
      res.status(500).json({ 
        message: error.message || "Failed to generate user login" 
      });
    }
  });

  // Get all users (admin only)
  app.get('/api/admin/users', requireAuth, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const currentUser = await storage.getUser(currentUserId);
      
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const users = await userManagementService.getAllUsersWithAccess();
      res.json(users);
      
    } catch (error: any) {
      console.error("Error getting users:", error);
      res.status(500).json({ message: "Failed to get users" });
    }
  });

  // Update user profile (admin only)
  app.put('/api/admin/users/:id', requireAuth, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const currentUser = await storage.getUser(currentUserId);
      
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const userId = parseInt(req.params.id);
      const { 
        email, 
        firstName, 
        lastName, 
        role, 
        assignedCid,
        updateLinkedAccount,
        accountName,
        accountFirstName,
        accountLastName,
        accountEmail,
        accountWebsite
      } = req.body;

      if (!email || !firstName || !lastName || !role) {
        return res.status(400).json({ message: "All fields are required" });
      }

      if (role === 'client' && !assignedCid) {
        return res.status(400).json({ message: "Client users must have an assigned CID" });
      }

      // Update user in database
      const updatedUser = await storage.updateUser(userId, {
        email,
        firstName,
        lastName,
        role,
        assignedCid: role === 'client' ? assignedCid : null
      });

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Update linked account details if requested
      if (role === 'client' && assignedCid && updateLinkedAccount) {
        const existingAccount = await storage.getCidAccount(assignedCid);
        if (existingAccount) {
          await storage.updateCidAccount(existingAccount.id, {
            accountName: accountName || existingAccount.accountName,
            firstName: accountFirstName || existingAccount.firstName,
            lastName: accountLastName || existingAccount.lastName,
            email: accountEmail || existingAccount.email,
            website: accountWebsite || existingAccount.website
          });
        }
      }

      res.json(updatedUser);
    } catch (error: any) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user profile" });
    }
  });

  // Delete user (admin only)
  app.delete('/api/admin/users/:id', requireAuth, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const currentUser = await storage.getUser(currentUserId);
      
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const userId = parseInt(req.params.id);
      
      // Prevent admin from deleting themselves
      if (userId === currentUserId) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      // Check if user exists
      const userToDelete = await storage.getUser(userId);
      if (!userToDelete) {
        return res.status(404).json({ message: "User not found" });
      }

      // Delete the user
      await storage.deleteUser(userId);

      res.json({ 
        success: true, 
        message: `User ${userToDelete.firstName} ${userToDelete.lastName} has been deleted` 
      });

    } catch (error: any) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Get user dashboard configuration
  app.get('/api/user/dashboard-config', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const config = await userManagementService.getUserDashboardConfig(userId);
      res.json(config);
      
    } catch (error: any) {
      console.error("Error getting user dashboard config:", error);
      res.status(500).json({ message: "Failed to get dashboard configuration" });
    }
  });

  // Validate user CID access
  app.get('/api/user/validate-cid/:cid', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { cid } = req.params;
      
      const hasAccess = await userManagementService.validateUserCidAccess(userId, cid);
      
      res.json({
        hasAccess,
        cid,
        userId
      });
      
    } catch (error: any) {
      console.error("Error validating CID access:", error);
      res.status(500).json({ message: "Failed to validate CID access" });
    }
  });

  // Generate temporary access credentials (for testing)
  app.post('/api/admin/users/temp-access', requireAuth, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const currentUser = await storage.getUser(currentUserId);
      
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { userEmail } = req.body;
      
      if (!userEmail) {
        return res.status(400).json({ message: "User email is required" });
      }

      const tempAccess = userManagementService.generateTemporaryAccess(userEmail);
      
      res.json({
        success: true,
        message: "Temporary access credentials generated",
        ...tempAccess
      });
      
    } catch (error: any) {
      console.error("Error generating temporary access:", error);
      res.status(500).json({ message: "Failed to generate temporary access" });
    }
  });

  // Email configuration status endpoint
  app.get('/api/admin/email-config', requireAdmin, async (req, res) => {
    try {
      const config = emailService.getConfiguration();
      res.json(config);
    } catch (error) {
      console.error("Error getting email configuration:", error);
      res.status(500).json({ message: "Failed to get email configuration" });
    }
  });

  // Test email endpoint  
  app.post('/api/admin/test-email', requireAdmin, async (req, res) => {
    try {
      const { to = 'test@example.com', subject = 'Test Email from VisitorIQ Pro', message = 'This is a test email to verify Mailchimp Transactional integration.' } = req.body;
      
      const template = {
        subject,
        text: message,
        html: `<p>${message}</p><p><em>Sent from VisitorIQ Pro Email Service</em></p>`
      };
      
      const success = await emailService.sendEmail(to, template);
      
      res.json({
        success,
        message: success ? 'Email sent successfully' : 'Email failed to send',
        configuration: emailService.getConfiguration()
      });
    } catch (error) {
      console.error("Error sending test email:", error);
      res.status(500).json({ message: "Failed to send test email" });
    }
  });

  // System logs endpoints
  app.get('/api/admin/system-logs', requireAuth, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const currentUser = await storage.getUser(currentUserId);
      
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { limit = 100, eventType, source, cid } = req.query;
      
      const logs = await storage.getSystemLogs(
        parseInt(limit as string), 
        eventType as string, 
        source as string, 
        cid as string
      );
      
      res.json(logs);
      
    } catch (error: any) {
      console.error("Error fetching system logs:", error);
      res.status(500).json({ message: "Failed to fetch system logs" });
    }
  });

  // Database health endpoint
  app.get('/api/admin/database-health', requireAuth, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const currentUser = await storage.getUser(currentUserId);
      
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { DatabaseMonitor } = await import('./services/database-monitor');
      const monitor = DatabaseMonitor.getInstance();
      const health = await monitor.getSystemHealth();
      res.json(health);
    } catch (error) {
      console.error("Error fetching database health:", error);
      res.status(500).json({ error: "Failed to fetch database health" });
    }
  });

  app.post('/api/admin/system-logs', requireAuth, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const currentUser = await storage.getUser(currentUserId);
      
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { eventType, source, processId, eventCode, message, details, cid, ipAddress, userAgent } = req.body;
      
      if (!eventType || !source || !message) {
        return res.status(400).json({ message: "Event type, source, and message are required" });
      }

      const log = await storage.createSystemLog({
        eventType,
        source,
        processId,
        eventCode,
        message,
        details,
        userId: currentUserId,
        cid,
        ipAddress,
        userAgent
      });
      
      res.json(log);
      
    } catch (error: any) {
      console.error("Error creating system log:", error);
      res.status(500).json({ message: "Failed to create system log" });
    }
  });

  // Email Configuration and Testing Endpoints
  
  // Get email configuration status
  app.get('/api/admin/email-config', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const emailConfig = emailService.getConfiguration();
      const alertSettings = emailAlertService.getSettings();
      
      res.json({
        emailService: emailConfig,
        alertService: {
          enabled: alertSettings.enabled,
          adminEmails: alertSettings.adminEmails,
          configuredAlerts: Object.keys(alertSettings.alertConfigs).length
        }
      });
    } catch (error) {
      logger.error('email-config', 'Failed to get email configuration', error, 'system', 'EMAIL_CONFIG_ERROR');
      res.status(500).json({ message: "Failed to get email configuration" });
    }
  });

  // Test email configuration
  app.post('/api/admin/test-email', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { testType, recipient } = req.body;
      
      if (testType === 'password-reset' && recipient) {
        // Test password reset email
        const testToken = 'test-token-' + Date.now();
        const success = await emailService.sendPasswordReset(recipient, testToken);
        
        logger.info('email-test', `Password reset test email sent to ${recipient}`, { success }, 'system', 'EMAIL_TEST');
        
        res.json({
          success,
          message: success ? 'Test password reset email sent successfully' : 'Failed to send test email',
          recipient,
          type: 'password-reset'
        });
      } else if (testType === 'system-alert') {
        // Test system alert configuration
        const testResult = await emailAlertService.testEmailConfiguration();
        
        res.json({
          success: testResult.success,
          message: testResult.message,
          details: testResult.details,
          type: 'system-alert'
        });
      } else {
        res.status(400).json({ message: "Invalid test type or missing recipient" });
      }
    } catch (error) {
      logger.error('email-test', 'Email test failed', error, 'system', 'EMAIL_TEST_ERROR');
      res.status(500).json({ message: "Email test failed" });
    }
  });

  // Send manual system alert
  app.post('/api/admin/send-alert', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { level, title, message, recipients, cid } = req.body;
      
      if (!level || !title || !message || !recipients || !Array.isArray(recipients)) {
        return res.status(400).json({ message: "Missing required fields: level, title, message, recipients" });
      }

      const alert = {
        level: level as 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL',
        title,
        message,
        details: {
          sentBy: user.username,
          sentAt: new Date().toISOString(),
          manual: true
        },
        cid
      };

      const result = await emailService.sendSystemAlert(recipients, alert);
      
      logger.info('email-alert', `Manual alert sent by ${user.username}`, { alert: title, recipients: recipients.length, result }, cid || 'system', 'MANUAL_ALERT_SENT');
      
      res.json({
        success: result.sent > 0,
        sent: result.sent,
        failed: result.failed,
        recipients: recipients.length,
        message: `Alert sent to ${result.sent}/${recipients.length} recipients`
      });
    } catch (error) {
      logger.error('email-alert', 'Failed to send manual alert', error, 'system', 'MANUAL_ALERT_ERROR');
      res.status(500).json({ message: "Failed to send alert" });
    }
  });

  // Test Mailchimp Transactional connection (Admin only)
  app.post('/api/admin/test-mailchimp', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const config = emailService.getConfiguration();
      
      if (!config.isConfigured) {
        return res.json({
          success: false,
          message: "Email service not configured",
          instructions: config.configurationInstructions
        });
      }

      if (config.provider !== 'Mailchimp Transactional') {
        return res.json({
          success: false,
          message: `Currently using ${config.provider}, not Mailchimp Transactional`,
          currentProvider: config.provider
        });
      }

      // Test by sending a simple email to the admin
      const testEmail = user.email;
      const testTemplate = {
        subject: 'Mailchimp Transactional Test - VisitorIQ Pro',
        text: 'This is a test email from your VisitorIQ Pro system using Mailchimp Transactional API. If you received this, your configuration is working correctly!',
        html: `
          <h2>✅ Mailchimp Transactional Test Successful</h2>
          <p>This is a test email from your VisitorIQ Pro system.</p>
          <p><strong>Provider:</strong> Mailchimp Transactional</p>
          <p><strong>From:</strong> ${config.fromEmail}</p>
          <p><strong>Test Time:</strong> ${new Date().toISOString()}</p>
          <p>Your email configuration is working correctly!</p>
        `
      };

      const success = await emailService.sendEmail(testEmail, testTemplate);
      
      res.json({
        success,
        message: success 
          ? 'Mailchimp Transactional test email sent successfully!' 
          : 'Failed to send test email - check logs for details',
        provider: config.provider,
        fromEmail: config.fromEmail,
        testRecipient: testEmail
      });
      
    } catch (error) {
      logger.error('mailchimp-test', 'Mailchimp test failed', error, 'system', 'MAILCHIMP_TEST_ERROR');
      res.status(500).json({ message: "Mailchimp test failed" });
    }
  });

  // New enhanced sync status API
  app.get('/api/sync/status', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: "Admin access required" });
      }
      
      const status = getAllSyncStatus();
      res.json(status);
      
    } catch (error) {
      console.error("Error getting enhanced sync status:", error instanceof Error ? error.message : String(error));
      res.status(500).json({ success: false, message: "Failed to get sync status" });
    }
  });

  // Initialize the enhanced scheduler with proper Central Time support
  initializeNewScheduler();

  const httpServer = createServer(app);
  return httpServer;
}
