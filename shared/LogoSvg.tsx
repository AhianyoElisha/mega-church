/**
 * The church mark: a yellow arch (the sanctuary doorway) carrying a cross,
 * with the wordmark beside it. Drawn inline rather than shipped as an asset so
 * it inherits the theme — the wordmark is `currentColor`, which is black on
 * white and white in dark mode, while the arch stays brand yellow in both.
 */
const LogoSvg = ({ className = '' }: { className?: string }) => {
  return (
    <svg
      className={`block w-full ${className}`}
      viewBox="0 0 200 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Mega Church"
    >
      {/* Arch — a rounded doorway sitting on a plinth. */}
      <path
        d="M8 46 V24 a16 16 0 0 1 32 0 V46 Z"
        fill="var(--color-primary-500)"
      />
      {/* Doorway cut out of the arch, so the mark reads at 20px. */}
      <path d="M18 46 V28 a6 6 0 0 1 12 0 V46 Z" fill="currentColor" />
      {/* Cross above the arch. */}
      <rect x="22.5" y="2" width="3" height="12" rx="1.5" fill="var(--color-primary-500)" />
      <rect x="18" y="5.5" width="12" height="3" rx="1.5" fill="var(--color-primary-500)" />

      {/* Wordmark. */}
      <text
        x="52"
        y="25"
        fill="currentColor"
        fontFamily="var(--font-sans, system-ui)"
        fontSize="17"
        fontWeight="700"
        letterSpacing="-0.4"
      >
        MEGA
      </text>
      <text
        x="52"
        y="43"
        fill="var(--color-primary-500)"
        fontFamily="var(--font-sans, system-ui)"
        fontSize="17"
        fontWeight="700"
        letterSpacing="-0.4"
      >
        CHURCH
      </text>
    </svg>
  )
}

export default LogoSvg
