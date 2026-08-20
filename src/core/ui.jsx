import React, { useEffect, useState } from "react";

// Small shared UI pieces used by the app shell and device view modules.

export function Stat({ label, value, note, series }) {
  return (
    <div className="stat">
      <span className="stat-label">
        {series && <i className={`chip ${series}`} />}
        {label}
      </span>
      <strong className="stat-value">{value}</strong>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

// Re-renders every intervalMs while active — drives local countdowns
// between polls.
export function useNow(intervalMs, active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}
