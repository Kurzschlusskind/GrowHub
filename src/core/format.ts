export function percent(value: number) {
  return `${Math.round(value)}%`;
}

export function timeLabel(minute: number) {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function parseTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return Math.max(0, Math.min(1439, hours * 60 + minutes));
}
