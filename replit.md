# VisitorIQ Pro - Real Estate Identity Resolution Platform

## Overview
VisitorIQ Pro is a full-stack TypeScript application designed as a professional identity resolution platform primarily for the real estate vertical. It enables businesses to identify anonymous website visitors by capturing MD5 hashed emails, enriching these identities with comprehensive demographic and real estate-specific data, and managing marketing campaigns. The platform aims to convert anonymous visitors into qualified leads through seamless integrations with identity resolution and marketing automation services.

## Recent Updates (August 2025)
- **Enhanced Scheduler Infrastructure (August 12, 2025)**: Completely refactored sync infrastructure by replacing legacy sync services with enhanced cron-based scheduler using luxon and cron libraries for proper Central Time timezone handling. Implemented new scheduler service with dynamic next sync time calculations and centralized job management. Added new `/api/sync/status` API endpoint providing unified status information for all sync services. Legacy endpoints remain functional for backward compatibility but redirect to enhanced scheduler.
- **Timezone Accuracy Improvements**: All sync times now display accurately in Central Time (CDT/CST) with proper daylight saving time transitions. Enhanced scheduler uses America/Chicago timezone for all cron jobs ensuring consistent execution regardless of server timezone. Admin dashboard now displays precise next sync times with proper formatting.
- **Sync Schedule Optimization**: SpherePixel and Handwrytten services run hourly from 8:00 AM to 8:00 PM Central Time (13 runs per day each). Mailchimp runs daily at 12:00 AM Central Time. All services use delta sync for efficiency, processing only new/updated records. Enhanced scheduler provides detailed status tracking with last run results and sync modes.
- **Code Architecture Cleanup**: Removed deprecated sync services and consolidated all scheduling logic into enhanced scheduler. Cleaned up legacy imports and references throughout codebase. Updated admin dashboard to use unified sync status API with improved error handling and status display. All sync services now use consistent logging patterns and status reporting.
- **Account-Level Handwrytten Configuration**: Implemented per-account Handwrytten settings allowing customizable sender names, message templates with variable replacement ({firstName}, {lastName}, etc.), handwriting style IDs, and return addresses. Added admin interface for managing these settings in the Business Account Management section.
- **Production-Ready Integrations**: Handwrytten API integration uses official `/orders/singleStepOrder` endpoint with proper payload structure, exponential backoff retry mechanism, and idempotency keys. Email Quality Selection Algorithm with improved 0-4 scale handling for optimal email selection. Household income display bug fixed across all components.

## User Preferences
Preferred communication style: Simple, everyday language.
Terminology preference: "Identities captured, defined by MD5 hashed emails" instead of "email captures"
Enrichment criteria: "Identities enriched" = household address + email address (both fields must be present)
Email provider preference: Mailchimp Transactional API instead of Microsoft 365 SMTP

## System Architecture
### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query
- **UI Framework**: Shadcn/ui (built on Radix UI)
- **Styling**: Tailwind CSS
- **Build Tool**: Vite

### Backend
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Custom username/password authentication (replaced Replit Auth)
- **Session Management**: Express sessions with PostgreSQL storage
- **API Design**: RESTful API

### Core Features
- **Authentication System**: Role-based access control (admin/client) with custom username/password login and session management. Admin-only user creation.
- **Identity Capture & Enrichment**: Privacy-compliant MD5 email hashing, integration with Audience Acuity for identity resolution, asynchronous enrichment processing, and status tracking. Enrichment focuses on real estate-specific data.
- **Campaign Management**: Creation, tracking, and status management of campaigns linked to enriched identity data.
- **Automated Sync Services**: Scheduled nightly syncs for pixel data, Mailchimp, and Handwrytten, with advanced delta sync logic for efficient incremental updates. Both Mailchimp and Handwrytten syncs only process new/updated contacts, dramatically improving performance. Mailchimp processes contacts with email+name data; Handwrytten processes contacts with complete addresses. **Account Status Protection**: All sync services automatically skip inactive accounts to prevent unauthorized processing. Includes manual trigger options for administrative control.
- **Data Import**: CSV upload system with intelligent header detection and manual field mapping for comprehensive data ingestion.
- **User Management**: Comprehensive user profile editing and account linking.
- **Account Management**: Centralized system for managing business accounts (CIDs) with status management and per-CID Handwrytten configuration.
- **System Monitoring**: Real-time status dashboards for API integrations and sync processes. Comprehensive system activity logs with Unix/Linux-style formatting, including timestamps, event types/severity levels (INFO/WARNING/ERROR/CRITICAL), source/process names, message content, process IDs, and event codes. Proactive database connection pool monitoring with automatic warnings and connection cleanup. Disk space monitoring with automatic emergency cleanup at 95% usage threshold. **Structured Logging**: Centralized logging utility with database persistence and standardized error handling patterns across all services.
- **Email System**: Comprehensive email functionality with Microsoft 365 SMTP integration, professional password reset emails, system alert notifications with color-coded templates, smart alert management with cooldown periods, and multi-provider support (SendGrid, Resend, SMTP). Includes testing endpoints and configuration management.

### Key Architectural Decisions
- **TypeScript First**: End-to-end type safety across frontend and backend.
- **Custom Authentication**: Moved away from third-party authentication for complete branding control and custom user management.
- **Modular Design**: Separation of concerns between frontend, backend, and services.
- **Database-Driven Status**: Persistent sync and system status stored in PostgreSQL.
- **Privacy-Centric**: Use of MD5 hashing for email identities.
- **Real Estate Focus**: Architecture and data schema tailored exclusively for the real estate industry, removing multi-vertical support.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Audience Acuity**: Identity enrichment service (via v2 API with custom OAuth/Bearer token authentication).
- **Mailchimp**: Email marketing platform.
- **Handwrytten**: Handwritten note service (integrated via API).
- **Cloudflare Worker**: Used for visitor data retrieval (`getVisitorsByCid` endpoint).
- **Microsoft 365**: Email service integration via SMTP (optimized configuration).
- **Neondatabase**: Serverless PostgreSQL connectivity.
- **Drizzle ORM**: Type-safe database ORM.
- **Express**: Backend web framework.
- **React**: Frontend framework.
- **TanStack React Query**: Server state management for React.
- **Radix UI / Shadcn/ui**: UI component libraries.
- **Tailwind CSS**: Styling framework.
- **Wouter**: Client-side routing.
- **Nodemailer**: Email transport for password resets and system alerts.
- **OpenID Client / Passport / Express-Session**: (Legacy authentication components, largely replaced by custom auth but may still exist for session management).
- **Axios**: HTTP client for API requests.