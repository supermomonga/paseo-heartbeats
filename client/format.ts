import type { HeartbeatCadence, HeartbeatSummary } from "../shared/heartbeats";

// Plain formatting helpers. Times use the client's local time zone with a
// numeric layout that reads the same in English and Japanese.

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "14:30" today, "11/17 09:00" this year, "2027/1/5 09:00" otherwise. */
export function formatShortTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return time;
  const monthDay = `${date.getMonth() + 1}/${date.getDate()}`;
  if (date.getFullYear() === now.getFullYear()) return `${monthDay} ${time}`;
  return `${date.getFullYear()}/${monthDay} ${time}`;
}

/** "2026/11/17 09:00:05". */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** "45s", "5m", "1h30m". */
export function formatInterval(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join("");
}

export function formatDuration(startIso: string, endIso: string | null): string | null {
  if (!endIso) return null;
  const ms = Date.parse(endIso) - Date.parse(startIso);
  return Number.isFinite(ms) ? formatInterval(ms) : null;
}

/** Cron cadences read as "0 9 * * * (Asia/Tokyo)"; intervals need translation. */
export function formatCron(cadence: Extract<HeartbeatCadence, { type: "cron" }>): string {
  return cadence.timezone ? `${cadence.expression} (${cadence.timezone})` : cadence.expression;
}

export function heartbeatTitle(heartbeat: Pick<HeartbeatSummary, "id" | "name" | "promptPreview">) {
  return heartbeat.name?.trim() || heartbeat.promptPreview || heartbeat.id;
}

/** The soonest upcoming run among active heartbeats, or null when none is active. */
export function nextRunAt(heartbeats: readonly HeartbeatSummary[]): string | null {
  let soonest: string | null = null;
  for (const heartbeat of heartbeats) {
    if (heartbeat.status !== "active" || !heartbeat.nextRunAt) continue;
    if (soonest === null || Date.parse(heartbeat.nextRunAt) < Date.parse(soonest)) {
      soonest = heartbeat.nextRunAt;
    }
  }
  return soonest;
}

/** Drops the transport's "Request failed:" prefix and request metadata from RPC errors. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Request failed:\s*/, "")
    .replace(/\s+requestType=\S+(\s+code=\S+)?\s*$/, "");
}
