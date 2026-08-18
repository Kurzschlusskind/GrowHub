export function percent(value) {
  return `${Math.round(value)}%`;
}

export function timeLabel(minute) {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function durationLabel(seconds) {
  if (seconds < 120) return `${seconds} s`;
  return `${Math.round(seconds / 60)} min`;
}

export function agoLabel(timestamp, now = Date.now()) {
  const minutes = Math.round((now - timestamp) / 60000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `vor ${hours} h`;
  return `vor ${Math.round(hours / 24)} d`;
}

export function parseTime(value) {
  const [hours, minutes] = (value || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return Math.max(0, Math.min(1439, hours * 60 + minutes));
}
