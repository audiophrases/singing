// Use elapsed time, not the device's calendar, to enforce a server-issued lease.
export function stampAccess(data, requestStarted = performance.now()) {
  const stamp = (access) => {
    if (access && Number.isFinite(access.serverNow) && Number.isFinite(access.expiresAt) && Number.isFinite(access.checkBy)) {
      access.deadline = requestStarted + Math.max(0, Math.min(access.expiresAt, access.checkBy) - access.serverNow);
    }
  };
  stamp(data?.access);
  stamp(data?.song?.access);
  for (const song of data?.songs || []) stamp(song.access);
  if (data?.urls && Number.isFinite(data.expiresAt) && Number.isFinite(data.serverNow)) {
    data.playbackDeadline = requestStarted + Math.max(0, data.expiresAt - data.serverNow);
    data.playbackDuration = Math.max(0, data.expiresAt - data.serverNow);
  }
  return data;
}

export const leaseRemaining = (access, now = performance.now()) => Number.isFinite(access?.deadline) ? Math.max(0, access.deadline - now) : 0;
