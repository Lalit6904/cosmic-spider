function TimerRing({
  seconds,
  remainingMs,
  totalMs,
  roundNumber,
  totalRounds
}) {
  const safeTotal = Math.max(1, totalMs);
  const progress = Math.max(0, Math.min(1, remainingMs / safeTotal));
  const circumference = 2 * Math.PI * 36;
  const urgent = seconds <= 10;
  const minutes = Math.floor(seconds / 60);
  const display = `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  return <div
    className={`timer-ring ${urgent ? "timer-ring--urgent" : ""}`}
    aria-label={`Round ${roundNumber} of ${totalRounds}. ${seconds} seconds remaining.`}
  >
      <svg viewBox="0 0 84 84" aria-hidden="true">
        <circle className="timer-ring__track" cx="42" cy="42" r="36" />
        <circle
    className="timer-ring__progress"
    cx="42"
    cy="42"
    r="36"
    strokeDasharray={circumference}
    strokeDashoffset={circumference * (1 - progress)}
  />
      </svg>
      <span className="timer-ring__value" aria-hidden="true">
        {display}
      </span>
      <span className="timer-ring__round" aria-hidden="true">
        R{roundNumber}/{totalRounds}
      </span>
    </div>;
}
export {
  TimerRing
};
