/** A small, on-brand mark: a bracket-and-spark glyph nodding to "generate". */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="8"
        fill="var(--color-surface-2)"
        stroke="var(--color-signal-dim)"
      />
      <path
        d="M11 9 L6 16 L11 23"
        stroke="var(--color-signal)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 9 L26 16 L21 23"
        stroke="var(--color-muted)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 7 L16 25"
        stroke="var(--color-violet)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
