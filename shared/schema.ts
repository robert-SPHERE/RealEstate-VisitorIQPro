import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  serial,
  integer,
  boolean,
  decimal,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Session storage table (mandatory for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table 
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username").notNull().unique(),
  email: varchar("email").notNull().unique(),
  password: varchar("password").notNull(), // hashed password
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role").notNull().default("client"), // admin or client
  assignedCid: varchar("assigned_cid"), // For client users - which CID they have access to
  resetToken: varchar("reset_token"), // For password reset
  resetTokenExpires: timestamp("reset_token_expires"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CID accounts table - each CID represents a different client account
export const cidAccounts = pgTable("cid_accounts", {
  id: serial("id").primaryKey(),
  cid: varchar("cid").notNull().unique(), // Client ID from pixel endpoint
  accountName: varchar("account_name"), // Human-readable account name
  accountLevel: varchar("account_level"), // Account level: identity_resolution, intent_flow_accelerator, handwritten_connect
  notes: varchar("notes"), // Account notes (renamed from description)

  // Contact information
  firstName: varchar("first_name"), // Contact first name
  lastName: varchar("last_name"), // Contact last name
  email: varchar("email"), // Contact email
  website: varchar("website"), // Website URL

  ownerId: integer("owner_id").references(() => users.id), // User who owns this CID
  status: varchar("status").notNull().default("active"), // active, inactive, suspended
  settings: jsonb("settings").default({}), // Business-specific configuration
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_cid_accounts_cid").on(table.cid),
  index("idx_cid_accounts_owner").on(table.ownerId),
]);

// Sync log table - tracks last sync timestamp per CID for delta sync efficiency
export const syncLog = pgTable("sync_log", {
  id: serial("id").primaryKey(),
  cid: varchar("cid").notNull().unique(),
  lastSyncedAt: timestamp("last_synced_at"),
  syncCount: integer("sync_count").default(0), // Total sync operations performed
  lastSyncRecords: integer("last_sync_records").default(0), // Records synced in last operation
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_sync_log_cid").on(table.cid),
  index("idx_sync_log_last_synced").on(table.lastSyncedAt),
]);

// Email captures table with comprehensive real estate data
export const emailCaptures = pgTable("email_captures", {
  id: serial("id").primaryKey(),
  
  // Basic capture info
  originalEmail: varchar("original_email"),
  hashedEmail: varchar("hashed_email").notNull(),
  cid: varchar("cid").notNull().default("default"), // Client ID - each CID is a different account
  userId: varchar("user_id").references(() => users.id),
  source: varchar("source").default("manual"), // manual, pixel_endpoint, form, etc.
  metadata: jsonb("metadata"), // Store pixel endpoint parameters and other source data
  enrichmentStatus: varchar("enrichment_status").default("pending"), // pending, completed, failed
  enrichmentData: jsonb("enrichment_data"),
  enrichmentError: varchar("enrichment_error"), // Store error message for failed enrichments
  retryCount: integer("retry_count").default(0), // Track number of retry attempts
  
  // Real Estate Identity Data Fields
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  address: varchar("address"),
  city: varchar("city"),
  state: varchar("state"),
  zip: varchar("zip"),
  gender: varchar("gender"),
  birthDate: varchar("birth_date"), // Store as string for flexibility
  email: varchar("email"), // Plain text email from enrichment
  // 👇 add these
  bestEmail: varchar("best_email"),
  bestEmailQuality: integer("best_email_quality"), // optional but recommended
  
  // Real Estate Specific Fields
  mortgageLoanType: varchar("mortgage_loan_type"),
  mortgageAmount: decimal("mortgage_amount", { precision: 12, scale: 2 }),
  mortgageAge: integer("mortgage_age"), // Years
  householdIncome: varchar("household_income"), // Store as text from Audience Acuity (e.g., "$200K to $249K")
  homeOwnership: varchar("home_ownership"),
  homePrice: decimal("home_price", { precision: 12, scale: 2 }),
  homeValue: decimal("home_value", { precision: 12, scale: 2 }),
  lengthOfResidence: integer("length_of_residence"), // Years
  age: integer("age"),
  maritalStatus: varchar("marital_status"),
  householdPersons: integer("household_persons"),
  householdChildren: integer("household_children"),
  
  // Additional tracking fields
  lastPageViewed: varchar("last_page_viewed"),
  url: varchar("url"), // Website Page Visited
  
  // Pixel endpoint specific fields
  sessionId: varchar("session_id"), // Visitor session identifier
  var1: varchar("var1"), // Additional tracking variable 1
  var2: varchar("var2"), // Additional tracking variable 2
  ts: varchar("ts"), // Timestamp from pixel endpoint
  ips: text("ips"), // IP addresses from Audience Acuity enrichment
  
  // Sync tracking fields
  mailchimpSyncedAt: timestamp("mailchimp_synced_at"), // Track when contact was last synced to Mailchimp
  handwryttenSyncedAt: timestamp("handwrytten_synced_at"), // Track when contact was last synced to Handwrytten
  
  capturedAt: timestamp("captured_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_email_captures_cid").on(table.cid),
  index("idx_email_captures_hashed_email_cid").on(table.hashedEmail, table.cid),
  index("idx_email_captures_email").on(table.email),
  index("idx_email_captures_captured_at").on(table.capturedAt),
]);

// API integrations table
export const apiIntegrations = pgTable("api_integrations", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull(), // audience_acuity, mailchimp
  status: varchar("status").notNull().default("active"), // active, inactive
  lastSync: timestamp("last_sync"),
  dailyRequests: integer("daily_requests").default(0),
  successRate: decimal("success_rate", { precision: 5, scale: 2 }),
  config: jsonb("config"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Campaigns table
export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull(),
  type: varchar("type").notNull(), // email, handwritten
  userId: varchar("user_id").references(() => users.id),
  recipients: integer("recipients").default(0),
  status: varchar("status").default("draft"), // draft, scheduled, in_progress, completed
  openRate: decimal("open_rate", { precision: 5, scale: 2 }),
  responseRate: decimal("response_rate", { precision: 5, scale: 2 }),
  scheduledAt: timestamp("scheduled_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Identity resolution metrics table - now CID-specific
export const identityMetrics = pgTable("identity_metrics", {
  id: serial("id").primaryKey(),
  cid: varchar("cid").notNull().default("default"), // Each CID has its own metrics
  geographicData: integer("geographic_data").default(0),
  propertyOwnership: integer("property_ownership").default(0),
  propertyValue: integer("property_value").default(0),
  mortgageStatus: integer("mortgage_status").default(0),
  moveInDate: integer("move_in_date").default(0),
  realEstateInterest: integer("real_estate_interest").default(0),
  hashedEmails: integer("hashed_emails").default(0),
  contactEmail: integer("contact_email").default(0),
  age: integer("age").default(0),
  phoneNumber: integer("phone_number").default(0),
  householdIncome: integer("household_income").default(0),
  familySize: integer("family_size").default(0),
  maritalStatus: integer("marital_status").default(0),
  purchaseHistory: integer("purchase_history").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_identity_metrics_cid").on(table.cid),
]);

// System logs table - comprehensive activity logging
export const systemLogs = pgTable("system_logs", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  eventType: varchar("event_type").notNull(), // INFO, WARNING, ERROR, CRITICAL
  source: varchar("source").notNull(), // Process/service name (e.g., 'sync-service', 'auth-service', 'enrichment-service')
  processId: varchar("process_id"), // Process ID or unique identifier
  eventCode: varchar("event_code"), // Event code/ID for categorization
  message: text("message").notNull(), // Human-readable message
  details: jsonb("details"), // Additional structured data
  userId: integer("user_id").references(() => users.id), // Associated user (if applicable)
  cid: varchar("cid"), // Associated account (if applicable)
  ipAddress: varchar("ip_address"), // Source IP (for auth events, etc.)
  userAgent: text("user_agent"), // User agent (for web events)
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_system_logs_timestamp").on(table.timestamp),
  index("idx_system_logs_event_type").on(table.eventType),
  index("idx_system_logs_source").on(table.source),
  index("idx_system_logs_cid").on(table.cid),
  index("idx_system_logs_user_id").on(table.userId),
]);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  emailCaptures: many(emailCaptures),
  campaigns: many(campaigns),
}));

export const emailCapturesRelations = relations(emailCaptures, ({ one }) => ({
  user: one(users, {
    fields: [emailCaptures.userId],
    references: [users.id],
  }),
}));

export const campaignsRelations = relations(campaigns, ({ one }) => ({
  user: one(users, {
    fields: [campaigns.userId],
    references: [users.id],
  }),
}));

// Schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  email: true,
  password: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
  role: true,
  assignedCid: true,
});

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});

export const resetPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const newPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const insertEmailCaptureSchema = createInsertSchema(emailCaptures).pick({
  originalEmail: true,
  hashedEmail: true,
  userId: true,
  cid: true,
  source: true,
  firstName: true,
  lastName: true,
  address: true,
  city: true,
  state: true,
  zip: true,
  gender: true,
  birthDate: true,
  email: true,
  mortgageLoanType: true,
  mortgageAmount: true,
  mortgageAge: true,
  householdIncome: true,
  homeOwnership: true,
  homePrice: true,
  homeValue: true,
  lengthOfResidence: true,
  age: true,
  maritalStatus: true,
  householdPersons: true,
  householdChildren: true,
  lastPageViewed: true,
  url: true,
});

export const insertCampaignSchema = createInsertSchema(campaigns).pick({
  name: true,
  type: true,
  userId: true,
  recipients: true,
  scheduledAt: true,
});

export const insertSystemLogSchema = createInsertSchema(systemLogs).pick({
  eventType: true,
  source: true,
  processId: true,
  eventCode: true,
  message: true,
  details: true,
  userId: true,
  cid: true,
  ipAddress: true,
  userAgent: true,
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Sync log types
export type SyncLog = typeof syncLog.$inferSelect;
export type InsertSyncLog = typeof syncLog.$inferInsert;
export type EmailCapture = typeof emailCaptures.$inferSelect;
export type InsertEmailCapture = z.infer<typeof insertEmailCaptureSchema>;
export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type ApiIntegration = typeof apiIntegrations.$inferSelect;
export type IdentityMetrics = typeof identityMetrics.$inferSelect;
export type SystemLog = typeof systemLogs.$inferSelect;
export type InsertSystemLog = typeof systemLogs.$inferInsert;

// Real Estate specific enrichment data structure
export interface RealEstateEnrichmentData {
  cid?: string;
  id?: string;
  firstName?: string;
  lastName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  gender?: string;
  birthDate?: string;
  email?: string;
  hashedEmail?: string;
  mortgageLoanType?: string;
  mortgageAmount?: number;
  mortgageAge?: number;
  householdIncome?: number;
  homeOwnership?: string;
  homePrice?: number;
  homeValue?: number;
  lengthOfResidence?: number;
  age?: number;
  maritalStatus?: string;
  householdPersons?: number;
  householdChildren?: number;
  url?: string;
}

// Business type specific field configurations
export const BUSINESS_TYPE_FIELDS = {
  real_estate: [
    { key: 'cid', label: 'Account Name' },
    { key: 'id', label: 'Record ID' },
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'address', label: 'Street Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'ZIP Code' },
    { key: 'gender', label: 'Gender' },
    { key: 'birthDate', label: 'Date of Birth' },
    { key: 'email', label: 'Email Address' },
    { key: 'bestEmail', label: 'Best Email' },
    { key: 'bestEmailQuality', label: 'Best Email Quality' },
    { key: 'hashedEmail', label: 'Hashed Email' },
    { key: 'mortgageLoanType', label: 'Mortgage Loan Type' },
    { key: 'mortgageAmount', label: 'Mortgage Amount' },
    { key: 'mortgageAge', label: 'Mortgage Age (Years)' },
    { key: 'householdIncome', label: 'Household Income' },
    { key: 'homeOwnership', label: 'Home Ownership' },
    { key: 'homePrice', label: 'Home Purchase Price' },
    { key: 'homeValue', label: 'Current Home Value' },
    { key: 'lengthOfResidence', label: 'Length of Residence (Years)' },
    { key: 'age', label: 'Age' },
    { key: 'maritalStatus', label: 'Marital Status' },
    { key: 'householdPersons', label: 'Household Size' },
    { key: 'householdChildren', label: 'Number of Children' },
    { key: 'url', label: 'Website Page Visited' }
  ]
} as const;