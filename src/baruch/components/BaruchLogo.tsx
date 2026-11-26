interface BaruchLogoProps {
  size?: number;
  className?: string;
}

/**
 * Monograma vetorial da BARUCH inspirado na identidade visual oficial:
 * B dourado facetado + seta de precisão diagonal sobre azul-marinho profundo.
 */
export function BaruchLogo({ size = 30, className = '' }: BaruchLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="BARUCH"
    >
      <defs>
        <linearGradient id="baruch-gold-grad" x1="6" y1="4" x2="30" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F1D48A" />
          <stop offset="48%" stopColor="#D4A643" />
          <stop offset="100%" stopColor="#9C7120" />
        </linearGradient>
        <linearGradient id="baruch-accent-grad" x1="8" y1="28" x2="23" y2="11" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2EA8FF" />
          <stop offset="52%" stopColor="#E12B8A" />
          <stop offset="100%" stopColor="#F5C736" />
        </linearGradient>
      </defs>
      <rect
        x="1"
        y="1"
        width="34"
        height="34"
        rx="8"
        fill="#0B2242"
        stroke="rgba(212, 175, 55, 0.35)"
        strokeWidth="1"
      />
      <path
        d="M11 8.5H20.8C24.3 8.5 26.6 10.4 26.6 13.4C26.6 15.6 25.3 17.2 23.2 17.9C25.7 18.6 27.3 20.5 27.3 23.1C27.3 26.6 24.6 28.5 20.6 28.5H11V24.6H19.8C21.6 24.6 22.8 23.7 22.8 22.2C22.8 20.7 21.6 19.9 19.8 19.9H15.2L17.4 16.5H19.6C21.2 16.5 22.2 15.7 22.2 14.3C22.2 13 21.2 12.2 19.6 12.2H11V8.5Z"
        fill="url(#baruch-gold-grad)"
      />
      <path
        d="M8.6 26.8C10.9 21.6 15.2 17.4 21.4 13.4L19.9 12.6L23.5 11.4L21.9 14.8L21.2 13.9C16.4 17.9 13.3 22.1 11.7 26.8H8.6Z"
        fill="url(#baruch-accent-grad)"
      />
    </svg>
  );
}
