import { CronJob } from 'cron';
import { DateTime } from 'luxon';

export type JobKey = 'spherePixel' | 'mailchimp' | 'handwrytten';
type RunResult = { ok: boolean; message: string; count?: number };

export interface JobDef {
  key: JobKey;
  cron: string;                 // e.g. "0 8-20 * * *"
  handler: () => Promise<RunResult>;
  mode: 'Delta Sync' | 'Full Sync';
}

const TZ = 'America/Chicago';

export const jobRegistry: Record<JobKey, {
  job: CronJob;
  lastRun?: Date;
  lastResult?: RunResult;
  mode: 'Delta Sync' | 'Full Sync';
}> = {} as any;

export function makeJob(def: JobDef) {
  const job = new CronJob(
    def.cron,
    async () => {
      try {
        console.log(`[${def.key}] Starting scheduled sync at ${new Date().toISOString()}`);
        const result = await def.handler();
        jobRegistry[def.key].lastRun = new Date();
        jobRegistry[def.key].lastResult = result;
        console.log(`[${def.key}] Completed: ${result.message} (${result.count || 0} processed)`);
      } catch (err: any) {
        console.error(`[${def.key}] Error:`, err);
        jobRegistry[def.key].lastRun = new Date();
        jobRegistry[def.key].lastResult = { ok: false, message: err?.message || 'Unknown error' };
      }
    },
    null,
    true,
    TZ
  );

  jobRegistry[def.key] = { job, mode: def.mode };
  console.log(`[${def.key}] Scheduled with cron: ${def.cron} in timezone: ${TZ}`);
  return job;
}

export function nextRunISO(key: JobKey): string | null {
  const j = jobRegistry[key]?.job;
  if (!j) return null;
  try {
    const nextDate = j.nextDate();
    if (!nextDate) return null;
    // Convert to proper ISO string in the timezone
    return DateTime.fromJSDate(nextDate.toJSDate(), { zone: TZ }).toISO();
  } catch (error) {
    console.error(`Error getting next run for ${key}:`, error);
    return null;
  }
}

export function formatLocal(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    return DateTime.fromISO(iso, { zone: TZ }).toFormat("LLL d, h:mm a 'CT'"); // e.g. Aug 9, 10:00 AM CT
  } catch (error) {
    console.error(`Error formatting date ${iso}:`, error);
    return null;
  }
}

export function getJobStatus(key: JobKey) {
  const r = jobRegistry[key];
  if (!r) return null;
  
  const next = nextRunISO(key);
  return {
    status: 'Scheduled' as const,
    nextSyncISO: next,
    nextSyncFormatted: formatLocal(next),
    lastSyncISO: r.lastRun?.toISOString() ?? null,
    lastResult: r.lastResult ? (r.lastResult.ok
      ? `${r.lastResult.count ?? 0} synced`
      : `Error: ${r.lastResult.message}`) : (r.lastRun ? 'No data' : 'Never'),
    syncMode: r.mode,
    isRunning: false // We can enhance this later with actual running state
  };
}