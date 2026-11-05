import React from 'react';

export const GeminiSparkleIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 18,
  className,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="gemini-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#1A73E8" />
        <stop offset="55%" stopColor="#7C3AED" />
        <stop offset="100%" stopColor="#DB2777" />
      </linearGradient>
    </defs>
    <path
      d="M12 2C12.35 7.2 16.8 11.65 22 12C16.8 12.35 12.35 16.8 12 22C11.65 16.8 7.2 12.35 2 12C7.2 11.65 11.65 7.2 12 2Z"
      fill="url(#gemini-grad)"
    />
  </svg>
);

export const LookerRingsIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 18,
  className,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
  >
    <circle cx="12" cy="14" r="6" stroke="#4285F4" strokeWidth="2.4" />
    <circle cx="9.2" cy="6.4" r="2.6" stroke="#34A853" strokeWidth="2" />
    <circle cx="15.2" cy="5.4" r="1.8" fill="#FBBC04" />
  </svg>
);

export const GoogleChatBrandIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M5 4h11a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-4 3.5V17a2 2 0 0 1-2-2V7a3 3 0 0 1 2-3Z"
      fill="#00AC47"
    />
    <path
      d="M9 8h10a3 3 0 0 1 3 3v8.5L18.5 17H11a2 2 0 0 1-2-2V8Z"
      fill="#5BB974"
      fillOpacity="0.85"
    />
  </svg>
);

export const SlackBrandIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="2" y="10" width="6" height="3.2" rx="1.6" fill="#E01E5A" />
    <circle cx="6.4" cy="15.8" r="1.6" fill="#E01E5A" />
    <rect x="10.8" y="2" width="3.2" height="6" rx="1.6" fill="#36C5F0" />
    <circle cx="8.2" cy="6.4" r="1.6" fill="#36C5F0" />
    <rect x="16" y="10.8" width="6" height="3.2" rx="1.6" fill="#2EB67D" />
    <circle cx="17.6" cy="8.2" r="1.6" fill="#2EB67D" />
    <rect x="10" y="16" width="3.2" height="6" rx="1.6" fill="#ECB22E" />
    <circle cx="15.8" cy="17.6" r="1.6" fill="#ECB22E" />
  </svg>
);
