import { pool, db } from '../db';
import { systemLogs } from '@shared/schema';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class DatabaseMonitor {
  private static instance: DatabaseMonitor;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private alertThresholds = {
    maxConnections: 18, // Alert when approaching max of 20
    minConnections: 2,  // Alert when too few connections
    highQueuedRequests: 10, // Alert when many requests are queued
    diskUsageWarning: 85, // Warning at 85% disk usage
    diskUsageCritical: 95  // Critical at 95% disk usage
  };

  static getInstance(): DatabaseMonitor {
    if (!DatabaseMonitor.instance) {
      DatabaseMonitor.instance = new DatabaseMonitor();
    }
    return DatabaseMonitor.instance;
  }

  private constructor() {}

  start() {
    if (this.monitoringInterval) {
      return; // Already running
    }

    // Database monitoring service started
    
    // Monitor every 30 seconds
    this.monitoringInterval = setInterval(() => {
      this.checkConnectionHealth();
      this.checkDiskSpace();
    }, 30000);

    // Initial checks
    this.checkConnectionHealth();
    this.checkDiskSpace();
  }

  stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      // Database monitoring stopped
    }
  }

  private async checkConnectionHealth() {
    try {
      const poolStats = {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      };

      const activeConnections = poolStats.totalCount - poolStats.idleCount;

      // Check for connection pool exhaustion warning
      if (activeConnections >= this.alertThresholds.maxConnections) {
        await this.logSystemEvent('WARNING', 'DB_POOL_HIGH', 
          `Database connection pool nearing capacity: ${activeConnections}/20 active connections`,
          { ...poolStats, activeConnections }
        );
      }

      // Check for high queued requests
      if (poolStats.waitingCount >= this.alertThresholds.highQueuedRequests) {
        await this.logSystemEvent('CRITICAL', 'DB_QUEUE_HIGH',
          `High number of queued database requests: ${poolStats.waitingCount} waiting`,
          poolStats
        );
      }

      // Check for connection pool exhaustion
      const maxConnections = 20; // Use our configured max
      if (activeConnections >= maxConnections) {
        await this.logSystemEvent('CRITICAL', 'DB_POOL_EXHAUST',
          'Database connection pool exhausted - all connections in use',
          { ...poolStats, maxConnections }
        );
      }

      // Log healthy status periodically (every 10 minutes)
      const now = Date.now();
      if (now % (10 * 60 * 1000) < 30000) { // Within 30 seconds of 10-minute mark
        await this.logSystemEvent('INFO', 'DB_HEALTH_OK',
          `Database connection pool healthy: ${activeConnections} active, ${poolStats.idleCount} idle`,
          poolStats
        );
      }

    } catch (error) {
      await this.logSystemEvent('ERROR', 'DB_MONITOR_ERR',
        'Database monitoring check failed',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private async checkDiskSpace() {
    try {
      // Check disk usage using df command
      const { stdout } = await execAsync('df -h /var/lib/data 2>/dev/null || df -h / 2>/dev/null || df -h .');
      const lines = stdout.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) return;
      
      const dataLine = lines[1];
      const parts = dataLine.split(/\s+/);
      
      if (parts.length >= 5) {
        const usagePercent = parseInt(parts[4].replace('%', ''));
        const totalSpace = parts[1];
        const usedSpace = parts[2];
        const availableSpace = parts[3];
        const mountPoint = parts[5] || '/';
        
        const diskStats = {
          path: mountPoint,
          totalSpace,
          usedSpace,
          availableSpace,
          usagePercent
        };

        if (usagePercent >= this.alertThresholds.diskUsageCritical) {
          await this.logSystemEvent('CRITICAL', 'DISK_CRITICAL',
            `Critical disk space usage at ${usagePercent}% - immediate cleanup required`,
            diskStats
          );
          
          // Attempt automatic cleanup for critical disk usage
          await this.performEmergencyCleanup();
          
        } else if (usagePercent >= this.alertThresholds.diskUsageWarning) {
          await this.logSystemEvent('WARNING', 'DISK_WARNING',
            `Disk space usage at ${usagePercent}% - cleanup recommended`,
            diskStats
          );
        }

        // Log healthy status every hour
        if (usagePercent < this.alertThresholds.diskUsageWarning) {
          const now = Date.now();
          if (now % (60 * 60 * 1000) < 30000) { // Within 30 seconds of hour mark
            await this.logSystemEvent('INFO', 'DISK_HEALTHY',
              `Disk space healthy: ${usagePercent}% used (${usedSpace}/${totalSpace})`,
              diskStats
            );
          }
        }
      }
    } catch (error) {
      await this.logSystemEvent('ERROR', 'DISK_CHECK_ERR',
        'Disk space monitoring check failed',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private async performEmergencyCleanup() {
    try {
      // Performing emergency disk cleanup
      
      // Clean up old log files
      await execAsync('find /tmp -name "*.log" -mtime +7 -delete 2>/dev/null || true');
      await execAsync('find /var/log -name "*.log.*" -mtime +30 -delete 2>/dev/null || true');
      
      // Clean old system logs (keep only last 1000 entries)
      await db.execute(`
        DELETE FROM system_logs 
        WHERE id NOT IN (
          SELECT id FROM (
            SELECT id FROM system_logs 
            ORDER BY timestamp DESC 
            LIMIT 1000
          ) AS keep_logs
        )
      `);
      
      await this.logSystemEvent('INFO', 'AUTO_CLEANUP',
        'Emergency disk cleanup completed - removed old logs and temp files',
        { action: 'emergency_cleanup' }
      );
      
    } catch (error) {
      await this.logSystemEvent('ERROR', 'CLEANUP_FAILED',
        'Emergency disk cleanup failed',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private async logSystemEvent(eventType: string, eventCode: string, message: string, details?: any) {
    try {
      await db.insert(systemLogs).values({
        timestamp: new Date(),
        eventType,
        source: 'database-service',
        processId: 'db-monitor',
        eventCode,
        message,
        details
      });
    } catch (error) {
      // Fallback to console if we can't log to database
      console.error(`[DatabaseMonitor] ${eventType}: ${message}`, details);
    }
  }

  // Manual health check method for API endpoints
  async getSystemHealth() {
    const connectionHealth = await this.getConnectionHealth();
    const diskHealth = await this.getDiskHealth();
    
    return {
      connections: connectionHealth,
      disk: diskHealth,
      overall: connectionHealth.status === 'critical' || diskHealth.status === 'critical' ? 'critical' :
               connectionHealth.status === 'warning' || diskHealth.status === 'warning' ? 'warning' : 'healthy'
    };
  }

  async getConnectionHealth() {
    const maxConnections = 20; // Use our configured max
    const poolStats = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
      maxConnections
    };

    const activeConnections = poolStats.totalCount - poolStats.idleCount;
    const utilizationPercent = Math.round((activeConnections / maxConnections) * 100);

    return {
      status: activeConnections >= maxConnections ? 'critical' : 
              activeConnections >= this.alertThresholds.maxConnections ? 'warning' : 'healthy',
      activeConnections,
      idleConnections: poolStats.idleCount,
      waitingRequests: poolStats.waitingCount,
      maxConnections,
      utilizationPercent,
      totalCount: poolStats.totalCount
    };
  }

  async getDiskHealth() {
    try {
      const { stdout } = await execAsync('df -h /var/lib/data 2>/dev/null || df -h / 2>/dev/null || df -h .');
      const lines = stdout.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        return { status: 'unknown', error: 'Unable to check disk space' };
      }
      
      const dataLine = lines[1];
      const parts = dataLine.split(/\s+/);
      
      if (parts.length >= 5) {
        const usagePercent = parseInt(parts[4].replace('%', ''));
        
        return {
          status: usagePercent >= this.alertThresholds.diskUsageCritical ? 'critical' :
                  usagePercent >= this.alertThresholds.diskUsageWarning ? 'warning' : 'healthy',
          usagePercent,
          totalSpace: parts[1],
          usedSpace: parts[2],
          availableSpace: parts[3],
          mountPoint: parts[5] || '/'
        };
      }
      
      return { status: 'unknown', error: 'Unable to parse disk usage' };
    } catch (error) {
      return { 
        status: 'error', 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }
}