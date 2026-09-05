export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`logo ${compact ? 'logo-compact' : ''}`} aria-label="Imnota">
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <rect x="3.5" y="4" width="17" height="17" rx="3" stroke="currentColor" strokeWidth="2" />
        <path
          d="M8 17V10.5M8 10.5L11.5 14L14.5 10.5L18 14"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M19.5 19.5L24 24M21.75 17.25L24 19.5"
          stroke="var(--indigo)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
      {!compact && <span>Imnota</span>}
    </div>
  );
}
