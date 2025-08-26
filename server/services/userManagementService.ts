/**
 * User Management Service
 * Handles user creation, role assignment, and access management
 */

import { storage } from "../storage";
import { nanoid } from "nanoid";
import * as crypto from "crypto";

export interface CreateUserRequest {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  role: 'admin' | 'client';
  assignedCid?: string;
  sendInvitation?: boolean;
}

export interface UserInvitation {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'client';
  assignedCid?: string;
  inviteToken: string;
  expiresAt: Date;
  createdBy: string;
  status: 'pending' | 'accepted' | 'expired';
  createdAt: Date;
}

export class UserManagementService {
  
  /**
   * Generate a login for a new user
   * This creates a user record that will be activated when they first log in via Replit Auth
   */
  async generateUserLogin(request: CreateUserRequest, createdBy: string): Promise<{
    user: any;
    loginInstructions: string;
    accessDetails: string;
    temporaryPassword: string;
  }> {
    try {
      // Use the provided password
      const temporaryPassword = request.password;
      
      // Generate a username from email (part before @)
      const username = request.email.split('@')[0];
      
      // Create user record with provided password
      const newUser = await storage.createUser({
        username,
        email: request.email,
        firstName: request.firstName,
        lastName: request.lastName,
        role: request.role,
        assignedCid: request.assignedCid,
        password: temporaryPassword, // This will be hashed by the storage layer
      });

      // Generate login instructions
      const loginInstructions = this.generateLoginInstructions(newUser);
      const accessDetails = this.generateAccessDetails(newUser);

      // If user is assigned to a CID, ensure the CID account exists
      if (request.assignedCid) {
        await this.ensureCidAccountExists(request.assignedCid, request.email);
      }

      return {
        user: newUser,
        loginInstructions,
        accessDetails,
        temporaryPassword
      };

    } catch (error: any) {
      console.error('Error generating user login:', error);
      throw new Error(`Failed to generate user login: ${error.message}`);
    }
  }

  /**
   * Generate a temporary password for new users
   */
  private generateTemporaryPassword(): string {
    // Generate a secure 12-character temporary password
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  /**
   * Generate login instructions for a new user
   */
  private generateLoginInstructions(user: any): string {
    const platformUrl = process.env.REPLIT_DOMAINS 
      ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`
      : 'http://localhost:5000';

    return `
# Welcome to VisitorIQ Pro

Hello ${user.firstName} ${user.lastName},

Your login has been created for VisitorIQ Pro - Real Estate Identity Resolution Platform.

## How to Access Your Account

1. **Visit the platform:** ${platformUrl}
2. **Click "Log In"** on the homepage
3. **Use your credentials:**
   - **Username:** ${user.username}
   - **Email:** ${user.email}
   - **Temporary Password:** [See password below]

## Your Account Details

- **Name:** ${user.firstName} ${user.lastName}
- **Username:** ${user.username}
- **Email:** ${user.email}
- **Role:** ${user.role === 'admin' ? 'Administrator' : 'Client User'}
- **Access Level:** ${user.assignedCid ? `Client Account: ${user.assignedCid}` : 'Full Platform Access'}

## Important Security Notice

**Your password has been set by the administrator.** Please:
1. Use your assigned password for login
2. Consider changing your password after logging in for better security
3. Do not share your login credentials with anyone

## What You Can Do

${user.role === 'admin' ? `
**As an Administrator, you can:**
- View all client accounts and data
- Manage business accounts and CID configurations
- Access system health monitoring and API integrations
- Create and manage marketing campaigns
- Generate comprehensive reports and analytics
- Manage user accounts and permissions
` : `
**As a Client User, you can:**
- View visitor identities captured for your business
- Access enriched contact information and demographics
- Create and manage marketing campaigns
- Export data for your business use
- Monitor visitor engagement and traffic patterns
- Track identity enrichment performance
`}

## Getting Started

1. Log in using the instructions above
2. Complete your profile setup if prompted
3. Explore the dashboard to familiarize yourself with features
4. Contact support if you need assistance

## Support

If you have any questions or need help getting started, please contact our support team.

---
Generated on: ${new Date().toLocaleString()}
Platform: VisitorIQ Pro Identity Resolution
    `.trim();
  }

  /**
   * Generate access details for a new user
   */
  private generateAccessDetails(user: any): string {
    const accessScope = user.role === 'admin' 
      ? 'Full platform administration access'
      : user.assignedCid 
        ? `Client access to account: ${user.assignedCid}`
        : 'Standard client access';

    return `
**User Access Configuration**

- **User ID:** ${user.id}
- **Email:** ${user.email}
- **Role:** ${user.role}
- **Access Scope:** ${accessScope}
- **Account Status:** Active
- **Created:** ${new Date().toLocaleString()}

**Security Features:**
- Replit Auth integration with OpenID Connect
- Role-based access control
- Session management with PostgreSQL storage
- Secure API endpoint protection

**Data Access:**
${user.role === 'admin' ? `
- All client accounts and business data
- System administration and configuration
- User management and role assignment
- Complete analytics and reporting
` : `
- Business data for assigned account only
- Visitor identity data and enrichment results
- Campaign management for your account
- Account-specific analytics and reports
`}
    `.trim();
  }

  /**
   * Ensure CID account exists for the assigned user
   */
  private async ensureCidAccountExists(cid: string, contactEmail: string): Promise<void> {
    try {
      const existingAccount = await storage.getCidAccount(cid);
      
      if (!existingAccount) {
        // Create the CID account
        await storage.upsertCidAccount({
          cid: cid,
          accountName: `Account ${cid}`,
          email: contactEmail,
          status: 'active'
        });
        
        console.log(`Created CID account: ${cid} for user: ${contactEmail}`);
      }
    } catch (error) {
      console.error(`Error ensuring CID account ${cid} exists:`, error);
      // Don't throw - this is not critical for user creation
    }
  }

  /**
   * List all users with their access details
   */
  async getAllUsersWithAccess(): Promise<any[]> {
    try {
      const allUsers = await storage.getAllUsers();
      
      return allUsers.map(user => ({
        ...user,
        accessDetails: this.generateAccessDetails(user),
        totalAccounts: user.role === 'admin' ? 'All accounts' : user.assignedCid || 'None assigned'
      }));
    } catch (error) {
      console.error('Error getting users with access:', error);
      return [];
    }
  }

  /**
   * Generate temporary access credentials for testing
   */
  generateTemporaryAccess(userEmail: string): {
    tempUserId: string;
    tempAccessToken: string;
    instructions: string;
  } {
    const tempUserId = `temp_${nanoid(8)}`;
    const tempAccessToken = crypto.randomBytes(32).toString('hex');
    
    const instructions = `
**Temporary Access Credentials**

For testing purposes, you can use these temporary credentials:

- **Temp User ID:** ${tempUserId}
- **Access Token:** ${tempAccessToken}
- **Valid For:** Testing authentication flow
- **Email:** ${userEmail}

**Note:** These are for development/testing only. 
Production users will authenticate through Replit Auth.
    `.trim();

    return {
      tempUserId,
      tempAccessToken,  
      instructions
    };
  }

  /**
   * Validate user access to specific CID
   */
  async validateUserCidAccess(userId: string, requestedCid: string): Promise<boolean> {
    try {
      const user = await storage.getUser(parseInt(userId));
      
      if (!user) {
        return false;
      }

      // Admin users have access to all CIDs
      if (user.role === 'admin') {
        return true;
      }

      // Client users only have access to their assigned CID
      return user.assignedCid === requestedCid;
      
    } catch (error) {
      console.error('Error validating user CID access:', error);
      return false;
    }
  }

  /**
   * Get user dashboard configuration based on role and access
   */
  async getUserDashboardConfig(userId: string): Promise<{
    dashboardType: 'admin' | 'client';
    accessibleCids: string[];
    features: string[];
    restrictions: string[];
  }> {
    try {
      const user = await storage.getUser(parseInt(userId));
      
      if (!user) {
        throw new Error('User not found');
      }

      const isAdmin = user.role === 'admin';
      
      return {
        dashboardType: isAdmin ? 'admin' : 'client',
        accessibleCids: isAdmin ? ['*'] : user.assignedCid ? [user.assignedCid] : [],
        features: isAdmin 
          ? ['user_management', 'system_admin', 'all_accounts', 'api_config']
          : ['client_dashboard', 'data_export', 'campaigns'],
        restrictions: isAdmin 
          ? []
          : ['no_user_management', 'single_account_access', 'no_system_config']
      };
      
    } catch (error) {
      console.error('Error getting user dashboard config:', error);
      throw error;
    }
  }
}

export const userManagementService = new UserManagementService();