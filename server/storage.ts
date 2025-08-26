import {
  users,
  emailCaptures,
  campaigns,
  apiIntegrations,
  identityMetrics,
  cidAccounts,
  syncLog,
  systemLogs,
  type User,
  type UpsertUser,
  type EmailCapture,
  type InsertEmailCapture,
  type Campaign,
  type InsertCampaign,
  type ApiIntegration,
  type IdentityMetrics,
  type SyncLog,
  type InsertSyncLog,
  type SystemLog,
  type InsertSystemLog,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  createUser(user: Omit<UpsertUser, 'id'>): Promise<User>;
  updateUser(id: number, updates: Partial<User>): Promise<User>;
  deleteUser(id: number): Promise<void>;
  upsertUser(user: UpsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  
  // Email capture operations
  createEmailCapture(capture: InsertEmailCapture): Promise<EmailCapture>;
  getEmailCaptures(userId?: string, cid?: string): Promise<EmailCapture[]>;
  getEmailCapturesByCid(cid: string): Promise<EmailCapture[]>;
  getEmailCapturesByDateRange(cid: string, fromDate?: Date, toDate?: Date): Promise<EmailCapture[]>;
  getEmailCaptureByHashAndCid(hashedEmail: string, cid: string): Promise<EmailCapture | undefined>;
  getEmailCaptureById(id: number): Promise<EmailCapture | undefined>;
  updateEmailCapture(id: number, updates: any): Promise<void>;
  updateEmailCaptureEnrichment(id: number, enrichmentData: any): Promise<void>;
  
  // CID account operations
  upsertCidAccount(account: { 
    cid: string; 
    accountName?: string; 
    accountLevel?: string;
    notes?: string; 
    firstName?: string;
    lastName?: string;
    email?: string;
    website?: string;
    ownerId?: number; 
    status?: string 
  }): Promise<any>;
  updateCidAccount(id: number, updates: {
    cid?: string;
    accountName?: string;
    accountLevel?: string;
    notes?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    website?: string;
    status?: string;
  }): Promise<any>;
  getCidAccounts(userId?: number): Promise<any[]>;
  getCidAccount(cid: string): Promise<any | undefined>;
  updateCidAccountHandwryttenSettings(cid: string, handwryttenMessage: string, handwryttenSignature: string, returnAddress?: any): Promise<any>;
  
  // Campaign operations
  createCampaign(campaign: InsertCampaign): Promise<Campaign>;
  getCampaigns(userId?: number): Promise<Campaign[]>;
  updateCampaignStatus(id: number, status: string): Promise<void>;
  
  // API integration operations
  getApiIntegrations(): Promise<ApiIntegration[]>;
  updateApiIntegration(name: string, updates: Partial<ApiIntegration>): Promise<void>;
  
  // Identity metrics operations
  getIdentityMetrics(cid?: string): Promise<IdentityMetrics | undefined>;
  updateIdentityMetrics(metrics: Partial<IdentityMetrics>, cid?: string): Promise<void>;
  
  // Access control helpers
  getUserAccessibleCids(userId: number): Promise<string[]>;
  canUserAccessCid(userId: number, cid: string): Promise<boolean>;
  
  // Sync log operations for delta sync
  getSyncLog(cid: string): Promise<SyncLog | undefined>;
  upsertSyncLog(cid: string, lastSyncedAt: string, recordCount: number): Promise<SyncLog>;
  
  // System logs operations
  createSystemLog(log: Omit<InsertSystemLog, 'timestamp' | 'createdAt'>): Promise<SystemLog>;
  getSystemLogs(limit?: number, eventType?: string, source?: string, cid?: string): Promise<SystemLog[]>;
  getSystemLogsByDateRange(fromDate: Date, toDate: Date, eventType?: string, source?: string): Promise<SystemLog[]>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.resetToken, token));
    return user;
  }

  async createUser(userData: Omit<UpsertUser, 'id'>): Promise<User> {
    // Hash the password before storing
    const { hashPassword } = await import('./auth');
    const hashedPassword = await hashPassword(userData.password);
    
    const [user] = await db
      .insert(users)
      .values({
        ...userData,
        password: hashedPassword
      })
      .returning();
    return user;
  }

  async updateUser(id: number, updates: Partial<User>): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return updatedUser;
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.username,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(users.createdAt);
  }

  // Email capture operations
  async createEmailCapture(capture: InsertEmailCapture): Promise<EmailCapture> {
    const [emailCapture] = await db
      .insert(emailCaptures)
      .values(capture)
      .returning();
    return emailCapture;
  }

  async getEmailCaptures(userId?: string, cid?: string): Promise<EmailCapture[]> {
    if (userId && cid) {
      return await db.select().from(emailCaptures)
        .where(and(eq(emailCaptures.userId, userId), eq(emailCaptures.cid, cid)))
        .orderBy(desc(emailCaptures.createdAt));
    } else if (userId) {
      return await db.select().from(emailCaptures)
        .where(eq(emailCaptures.userId, userId))
        .orderBy(desc(emailCaptures.createdAt));
    } else if (cid) {
      return await db.select().from(emailCaptures)
        .where(eq(emailCaptures.cid, cid))
        .orderBy(desc(emailCaptures.createdAt));
    } else {
      return await db.select().from(emailCaptures)
        .orderBy(desc(emailCaptures.createdAt));
    }
  }

  async getEmailCapturesByCid(cid: string): Promise<EmailCapture[]> {
    return await db.select().from(emailCaptures)
      .where(eq(emailCaptures.cid, cid))
      .orderBy(desc(emailCaptures.createdAt));
  }

  async getEmailCapturesByDateRange(cid: string, fromDate?: Date, toDate?: Date): Promise<EmailCapture[]> {
    let baseQuery = db.select().from(emailCaptures);
    
    if (fromDate && toDate) {
      return await baseQuery
        .where(and(
          eq(emailCaptures.cid, cid),
          gte(emailCaptures.createdAt, fromDate),
          lte(emailCaptures.createdAt, toDate)
        ))
        .orderBy(desc(emailCaptures.createdAt));
    } else if (fromDate) {
      return await baseQuery
        .where(and(
          eq(emailCaptures.cid, cid),
          gte(emailCaptures.createdAt, fromDate)
        ))
        .orderBy(desc(emailCaptures.createdAt));
    } else if (toDate) {
      return await baseQuery
        .where(and(
          eq(emailCaptures.cid, cid),
          lte(emailCaptures.createdAt, toDate)
        ))
        .orderBy(desc(emailCaptures.createdAt));
    } else {
      return await baseQuery
        .where(eq(emailCaptures.cid, cid))
        .orderBy(desc(emailCaptures.createdAt));
    }
  }

  async getEmailCaptureByHashAndCid(hashedEmail: string, cid: string): Promise<EmailCapture | undefined> {
    const [capture] = await db.select().from(emailCaptures)
      .where(and(eq(emailCaptures.hashedEmail, hashedEmail), eq(emailCaptures.cid, cid)));
    return capture;
  }

  async getEmailCaptureById(id: number): Promise<EmailCapture | undefined> {
    const [capture] = await db.select().from(emailCaptures)
      .where(eq(emailCaptures.id, id));
    return capture;
  }

  async updateEmailCapture(id: number, updates: any): Promise<void> {
    await db
      .update(emailCaptures)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(emailCaptures.id, id));
  }

  async updateEmailCaptureEnrichment(id: number, enrichmentData: any): Promise<void> {
    await db
      .update(emailCaptures)
      .set({
        enrichmentData,
        enrichmentStatus: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(emailCaptures.id, id));
  }

  // Campaign operations
  async createCampaign(campaign: InsertCampaign): Promise<Campaign> {
    const [newCampaign] = await db
      .insert(campaigns)
      .values(campaign)
      .returning();
    return newCampaign;
  }

  async getCampaigns(userId?: number): Promise<Campaign[]> {
    if (userId) {
      return await db.select().from(campaigns)
        .where(eq(campaigns.userId, String(userId)))
        .orderBy(desc(campaigns.createdAt));
    } else {
      return await db.select().from(campaigns)
        .orderBy(desc(campaigns.createdAt));
    }
  }

  async updateCampaignStatus(id: number, status: string): Promise<void> {
    await db
      .update(campaigns)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, id));
  }

  // API integration operations
  async getApiIntegrations(): Promise<ApiIntegration[]> {
    return await db.select().from(apiIntegrations);
  }

  async updateApiIntegration(name: string, updates: Partial<ApiIntegration>): Promise<void> {
    await db
      .update(apiIntegrations)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(apiIntegrations.name, name));
  }

  // CID account operations
  async upsertCidAccount(account: { 
    cid: string; 
    accountName?: string; 
    accountLevel?: string;
    notes?: string; 
    firstName?: string;
    lastName?: string;
    email?: string;
    website?: string;
    ownerId?: number; 
    status?: string;
    handwryttenSender?: string;
    handwritingId?: string;
    handwryttenTemplate?: string;
    returnCompany?: string;
    returnAddress1?: string;
    returnAddress2?: string;
    returnCity?: string;
    returnState?: string;
    returnZip?: string;
  }): Promise<any> {
    // Build Handwrytten settings object if any are provided
    const handwryttenSettings = (account.handwryttenSender || account.handwritingId || account.handwryttenTemplate || account.returnCompany || account.returnAddress1 || account.returnCity) ? {
      handwritten: {
        senderName: account.handwryttenSender || '',
        handwritingId: account.handwritingId || '',
        messageTemplate: account.handwryttenTemplate || '',
        returnAddress: (account.returnCompany || account.returnAddress1 || account.returnCity) ? {
          company: account.returnCompany || '',
          address1: account.returnAddress1 || '',
          address2: account.returnAddress2 || '',
          city: account.returnCity || '',
          state: account.returnState || '',
          zip: account.returnZip || ''
        } : undefined
      }
    } : {};

    const [cidAccount] = await db
      .insert(cidAccounts)
      .values({
        cid: account.cid,
        accountName: account.accountName,
        accountLevel: account.accountLevel,
        notes: account.notes,
        firstName: account.firstName,
        lastName: account.lastName,
        email: account.email,
        website: account.website,
        ownerId: account.ownerId,
        status: account.status || 'active',
        settings: handwryttenSettings,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: cidAccounts.cid,
        set: {
          accountName: account.accountName,
          accountLevel: account.accountLevel,
          notes: account.notes,
          firstName: account.firstName,
          lastName: account.lastName,
          email: account.email,
          website: account.website,
          ownerId: account.ownerId,
          status: account.status,
          settings: handwryttenSettings,
          updatedAt: new Date(),
        },
      })
      .returning();
    return cidAccount;
  }

  async getCidAccounts(userId?: number): Promise<any[]> {
    if (userId) {
      return await db.select().from(cidAccounts).where(eq(cidAccounts.ownerId, userId));
    }
    return await db.select().from(cidAccounts);
  }

  async getCidAccount(cid: string): Promise<any | undefined> {
    const [account] = await db.select().from(cidAccounts).where(eq(cidAccounts.cid, cid));
    return account;
  }

  async updateCidAccount(id: number, updates: {
    cid?: string;
    accountName?: string;
    accountLevel?: string;
    notes?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    website?: string;
    status?: string;
    settings?: any;
  }): Promise<any> {
    const [account] = await db
      .update(cidAccounts)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(cidAccounts.id, id))
      .returning();
    return account;
  }

  async updateCidAccountHandwryttenSettings(cid: string, handwryttenMessage?: string, handwryttenSignature?: string, returnAddress?: any): Promise<any | undefined> {
    const cidAccount = await this.getCidAccount(cid);
    if (!cidAccount) return undefined;

    const currentSettings = (cidAccount.settings as any) || {};
    const updatedSettings = {
      ...currentSettings,
      handwryttenMessage: handwryttenMessage || undefined,
      handwryttenSignature: handwryttenSignature || undefined,
      handwryttenReturnAddress: returnAddress || undefined
    };

    const [updatedAccount] = await db
      .update(cidAccounts)
      .set({ 
        settings: updatedSettings,
        updatedAt: new Date() 
      })
      .where(eq(cidAccounts.cid, cid))
      .returning();
    return updatedAccount;
  }

  // Access control methods
  async getUserAccessibleCids(userId: number): Promise<string[]> {
    const user = await this.getUser(userId);
    if (!user) return [];
    
    if (user.role === 'admin') {
      // Admins can access all CIDs
      const allAccounts = await db.select().from(cidAccounts);
      return allAccounts.map(account => account.cid);
    } else {
      // Clients can only access their assigned CID
      if (user.assignedCid) {
        return [user.assignedCid];
      }
      return [];
    }
  }

  async canUserAccessCid(userId: number, cid: string): Promise<boolean> {
    const accessibleCids = await this.getUserAccessibleCids(userId);
    return accessibleCids.includes(cid);
  }

  // CID-specific identity metrics
  async getIdentityMetrics(cid?: string): Promise<IdentityMetrics | undefined> {
    if (cid) {
      const [metrics] = await db.select().from(identityMetrics).where(eq(identityMetrics.cid, cid));
      return metrics;
    }
    
    // For admin view, return aggregated metrics across all CIDs
    const allMetrics = await db.select().from(identityMetrics);
    if (allMetrics.length === 0) return undefined;
    
    // Aggregate metrics from all CIDs
    const aggregated = allMetrics.reduce((acc, metric) => ({
      id: 0,
      cid: 'all',
      geographicData: (acc.geographicData || 0) + (metric.geographicData || 0),
      propertyOwnership: (acc.propertyOwnership || 0) + (metric.propertyOwnership || 0),
      propertyValue: (acc.propertyValue || 0) + (metric.propertyValue || 0),
      mortgageStatus: (acc.mortgageStatus || 0) + (metric.mortgageStatus || 0),
      moveInDate: (acc.moveInDate || 0) + (metric.moveInDate || 0),
      realEstateInterest: (acc.realEstateInterest || 0) + (metric.realEstateInterest || 0),
      hashedEmails: (acc.hashedEmails || 0) + (metric.hashedEmails || 0),
      contactEmail: (acc.contactEmail || 0) + (metric.contactEmail || 0),
      age: (acc.age || 0) + (metric.age || 0),
      phoneNumber: (acc.phoneNumber || 0) + (metric.phoneNumber || 0),
      householdIncome: (acc.householdIncome || 0) + (metric.householdIncome || 0),
      familySize: (acc.familySize || 0) + (metric.familySize || 0),
      maritalStatus: (acc.maritalStatus || 0) + (metric.maritalStatus || 0),
      purchaseHistory: (acc.purchaseHistory || 0) + (metric.purchaseHistory || 0),
      updatedAt: new Date(),
    }), {
      id: 0,
      cid: 'all',
      geographicData: 0,
      propertyOwnership: 0,
      propertyValue: 0,
      mortgageStatus: 0,
      moveInDate: 0,
      realEstateInterest: 0,
      hashedEmails: 0,
      contactEmail: 0,
      age: 0,
      phoneNumber: 0,
      householdIncome: 0,
      familySize: 0,
      maritalStatus: 0,
      purchaseHistory: 0,
      updatedAt: new Date(),
    });
    
    return aggregated;
  }

  async updateIdentityMetrics(metrics: Partial<IdentityMetrics>, cid: string = 'default'): Promise<void> {
    await db
      .insert(identityMetrics)
      .values({
        cid,
        geographicData: metrics.geographicData || 0,
        propertyOwnership: metrics.propertyOwnership || 0,
        propertyValue: metrics.propertyValue || 0,
        mortgageStatus: metrics.mortgageStatus || 0,
        moveInDate: metrics.moveInDate || 0,
        realEstateInterest: metrics.realEstateInterest || 0,
        hashedEmails: metrics.hashedEmails || 0,
        contactEmail: metrics.contactEmail || 0,
        age: metrics.age || 0,
        phoneNumber: metrics.phoneNumber || 0,
        householdIncome: metrics.householdIncome || 0,
        familySize: metrics.familySize || 0,
        maritalStatus: metrics.maritalStatus || 0,
        purchaseHistory: metrics.purchaseHistory || 0,
      })
      .onConflictDoUpdate({
        target: identityMetrics.cid,
        set: {
          geographicData: metrics.geographicData || 0,
          propertyOwnership: metrics.propertyOwnership || 0,
          propertyValue: metrics.propertyValue || 0,
          mortgageStatus: metrics.mortgageStatus || 0,
          moveInDate: metrics.moveInDate || 0,
          realEstateInterest: metrics.realEstateInterest || 0,
          hashedEmails: metrics.hashedEmails || 0,
          contactEmail: metrics.contactEmail || 0,
          age: metrics.age || 0,
          phoneNumber: metrics.phoneNumber || 0,
          householdIncome: metrics.householdIncome || 0,
          familySize: metrics.familySize || 0,
          maritalStatus: metrics.maritalStatus || 0,
          purchaseHistory: metrics.purchaseHistory || 0,
          updatedAt: new Date(),
        },
      });
  }

  // Sync log operations for delta sync optimization
  async getSyncLog(cid: string): Promise<SyncLog | undefined> {
    const [log] = await db.select().from(syncLog).where(eq(syncLog.cid, cid));
    return log;
  }

  async upsertSyncLog(cid: string, lastSyncedAt: string, recordCount: number): Promise<SyncLog> {
    const [log] = await db
      .insert(syncLog)
      .values({
        cid,
        lastSyncedAt: new Date(lastSyncedAt),
        syncCount: 1,
        lastSyncRecords: recordCount,
      })
      .onConflictDoUpdate({
        target: syncLog.cid,
        set: {
          lastSyncedAt: new Date(lastSyncedAt),
          syncCount: sql`${syncLog.syncCount} + 1`,
          lastSyncRecords: recordCount,
          updatedAt: new Date(),
        },
      })
      .returning();
    return log;
  }

  // System logs operations
  async createSystemLog(log: Omit<InsertSystemLog, 'timestamp' | 'createdAt'>): Promise<SystemLog> {
    const [newLog] = await db
      .insert(systemLogs)
      .values(log)
      .returning();
    return newLog;
  }

  async getSystemLogs(limit: number = 100, eventType?: string, source?: string, cid?: string): Promise<SystemLog[]> {
    let conditions = [];
    
    if (eventType) {
      conditions.push(eq(systemLogs.eventType, eventType));
    }
    if (source) {
      conditions.push(eq(systemLogs.source, source));
    }
    if (cid) {
      conditions.push(eq(systemLogs.cid, cid));
    }
    
    const logs = await db
      .select()
      .from(systemLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(systemLogs.timestamp))
      .limit(limit);
    
    return logs;
  }

  async getSystemLogsByDateRange(fromDate: Date, toDate: Date, eventType?: string, source?: string): Promise<SystemLog[]> {
    let conditions = [
      gte(systemLogs.timestamp, fromDate),
      lte(systemLogs.timestamp, toDate)
    ];
    
    if (eventType) {
      conditions.push(eq(systemLogs.eventType, eventType));
    }
    if (source) {
      conditions.push(eq(systemLogs.source, source));
    }
    
    const logs = await db
      .select()
      .from(systemLogs)
      .where(and(...conditions))
      .orderBy(desc(systemLogs.timestamp));
    
    return logs;
  }
}

export const storage = new DatabaseStorage();