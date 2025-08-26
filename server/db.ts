import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Configure connection pool with proper limits
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of connections in the pool
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  connectionTimeoutMillis: 10000, // Connection timeout of 10 seconds
});

export const db = drizzle({ client: pool, schema });

// Monitor pool events and log critical issues
pool.on('error', (err) => {
  console.error('[DATABASE] Pool error:', err);
  // Log to system logs
  try {
    db.insert(schema.systemLogs).values({
      timestamp: new Date(),
      eventType: 'CRITICAL',
      source: 'database-service',
      processId: 'pool-monitor',
      eventCode: 'DB_POOL_ERROR',
      message: 'Database connection pool error occurred',
      details: { error: err.message, stack: err.stack }
    }).execute().catch(console.error);
  } catch (logError) {
    console.error('[DATABASE] Failed to log pool error:', logError);
  }
});

// Pool monitoring for production debugging if needed
pool.on('connect', () => {
  // Connection established
});

pool.on('remove', () => {
  // Connection removed from pool
});