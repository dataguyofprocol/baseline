export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="baseline-bg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6e79d6" />
          <stop offset="100%" stopColor="#4f5bbd" />
        </linearGradient>
        <filter id="baseline-shadow" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#0b0b0f" floodOpacity={0.35} />
        </filter>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#baseline-bg)" />
      <g filter="url(#baseline-shadow)">
        <line x1="7" y1="16" x2="25" y2="16" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <circle cx="16" cy="16" r="4.5" fill="url(#baseline-bg)" stroke="#fff" strokeWidth="2.5" />
      </g>
    </svg>
  );
}
