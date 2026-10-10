import React from "react";

/* Inline SVG iconography — no emojis anywhere. Stroke-based, currentColor. */
const base = (size) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});

export const IconCheck = ({ size = 14 }) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 12.2l2.4 2.4 4.6-5" />
  </svg>
);

export const IconWarn = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M12 3.5L22 20H2L12 3.5z" />
    <path d="M12 9.5v4.5" />
    <circle cx="12" cy="17" r="0.4" fill="currentColor" />
  </svg>
);

export const IconCrit = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5z" />
    <path d="M12 7.5v6" />
    <circle cx="12" cy="16.6" r="0.4" fill="currentColor" />
  </svg>
);

export const IconStale = ({ size = 14 }) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.4 2" />
  </svg>
);

export const IconOffline = ({ size = 14 }) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.8 5.8l12.4 12.4" />
  </svg>
);

export const IconInfo = ({ size = 14 }) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <circle cx="12" cy="8" r="0.4" fill="currentColor" />
  </svg>
);

export const IconGauge = ({ size = 18 }) => (
  <svg {...base(size)}>
    <path d="M4 14a8 8 0 1 1 16 0" />
    <path d="M12 14l4.5-5.5" />
    <path d="M4 18h16" />
  </svg>
);

export const IconMap = ({ size = 18 }) => (
  <svg {...base(size)}>
    <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
    <path d="M9 4v14M15 6v14" />
  </svg>
);

export const IconSensor = ({ size = 18 }) => (
  <svg {...base(size)}>
    <rect x="7" y="7" width="10" height="10" transform="rotate(45 12 12)" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
  </svg>
);

export const IconBell = ({ size = 18 }) => (
  <svg {...base(size)}>
    <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </svg>
);

export const IconChart = ({ size = 18 }) => (
  <svg {...base(size)}>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <path d="M8 16v-5M12 16V8M16 16v-8" />
  </svg>
);

export const IconCalc = ({ size = 18 }) => (
  <svg {...base(size)}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M8 7h8" />
    <path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01" />
  </svg>
);

export const IconShield = ({ size = 18 }) => (
  <svg {...base(size)}>
    <path d="M12 3l7 3v6c0 4.5-3 3.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    <path d="M9 12l2 2 4-4.5" />
  </svg>
);

export const IconDoc = ({ size = 18 }) => (
  <svg {...base(size)}>
    <path d="M6 2h8l4 4v16H6V2z" />
    <path d="M14 2v4h4" />
    <path d="M9 12h6M9 16h6" />
  </svg>
);

export const IconDownload = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M12 3v12" />
    <path d="M7 10l5 5 5-5" />
    <path d="M4 20h16" />
  </svg>
);

export const IconUsers = ({ size = 18 }) => (
  <svg {...base(size)}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 5a3.5 3.5 0 0 1 0 7M17.5 14.5a6.5 6.5 0 0 1 4 5.5" />
  </svg>
);

export const IconX = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconPlus = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconCheckSmall = ({ size = 13 }) => (
  <svg {...base(size)}>
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);

export const IconFan = ({ size = 18 }) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    <path d="M12 10.4C10 8 9 5.5 10.5 4.5c1.8-1.2 3.8 1 3 3.5" />
    <path d="M13.6 12.8c2 2.4 2.9 4.9 1.4 5.9-1.8 1.2-3.8-1-3-3.5" />
    <path d="M10.4 13.6C8 12.6 5.4 12.9 5 14.6c-.5 2 2.4 2.8 4.4 1.3" />
  </svg>
);

export const IconLogout = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </svg>
);

export const IconClock = ({ size = 13 }) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.4 2" />
  </svg>
);

/* ---- v2 additions ---- */

export const IconDoor = ({ size = 18 }) => (
  <svg {...base(size)}>
    <rect x="5" y="3" width="14" height="18" rx="1" />
    <path d="M9 3v18" strokeDasharray="2 2" />
    <circle cx="15.5" cy="12" r="0.6" fill="currentColor" />
  </svg>
);

export const IconRegulator = ({ size = 18 }) => (
  <svg {...base(size)}>
    <path d="M3 8h18M3 16h18" />
    <path d="M7 8v8M17 8v8" />
    <path d="M7 12h4M13 12h4" strokeDasharray="2 1.5" />
  </svg>
);

export const IconBranch = ({ size = 18 }) => (
  <svg {...base(size)}>
    <circle cx="5" cy="12" r="2.2" />
    <circle cx="19" cy="6" r="2.2" />
    <circle cx="19" cy="18" r="2.2" />
    <path d="M7 12h5l5-4.5M12 12l5 4.5" />
  </svg>
);

export const IconSim = ({ size = 18 }) => (
  <svg {...base(size)}>
    <path d="M9 3h6" />
    <path d="M10 3v6l-5.5 9.5a1 1 0 0 0 .9 1.5h13.2a1 1 0 0 0 .9-1.5L14 9V3" />
    <path d="M7.5 15h9" />
  </svg>
);

export const IconAudit = ({ size = 18 }) => (
  <svg {...base(size)}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="3.5" cy="6" r="1" fill="currentColor" />
    <circle cx="3.5" cy="12" r="1" fill="currentColor" />
    <circle cx="3.5" cy="18" r="1" fill="currentColor" />
  </svg>
);

export const IconSettings = ({ size = 18 }) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

export const IconPlay = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M7 4.5l12 7.5-12 7.5v-15z" />
  </svg>
);

export const IconPause = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M8 4.5v15M16 4.5v15" strokeWidth={2.6} />
  </svg>
);

export const IconReset = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M4 10a8 8 0 1 1-1 5.5" />
    <path d="M4 4v6h6" />
  </svg>
);

export const IconHistory = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M3.5 12a8.5 8.5 0 1 1-2.5 6" />
    <path d="M3.5 12H1.8M3.5 12V7" opacity="0" />
    <path d="M12 7.5V12l3.5 2" />
    <path d="M3.6 18L1.5 18.5 2 16.4" opacity="0" />
  </svg>
);

export const IconSearch = ({ size = 16 }) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M16.5 16.5L21 21" />
  </svg>
);

export const IconZap = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />
  </svg>
);

export const IconChevronR = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export const IconLayers = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </svg>
);

export const IconFit = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
);

export const IconStepBack = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M15 5l-7 7 7 7" />
    <path d="M8 5v14" strokeWidth={2.4} />
  </svg>
);

export const IconStepFwd = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M9 5l7 7-7 7" />
    <path d="M16 5v14" strokeWidth={2.4} />
  </svg>
);

export const IconWind = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M3 8h9.5a2.5 2.5 0 1 0-2.5-2.5" />
    <path d="M3 12h14.5a2.5 2.5 0 1 1-2.5 2.5" />
    <path d="M3 16h7" />
  </svg>
);

export const IconTherm = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M10 4a2 2 0 0 1 4 0v9.3a4.5 4.5 0 1 1-4 0V4z" />
    <circle cx="12" cy="17.5" r="1.6" fill="currentColor" />
  </svg>
);

export const IconCmd = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zm0 0v6m0-6h6m-6 6H6.5A2.5 2.5 0 1 0 9 15m6-6h2.5A2.5 2.5 0 1 0 15 6.5V9zm0 6v2.5a2.5 2.5 0 1 1-2.5 2.5H15" />
  </svg>
);

export const IconGo = ({ size = 13 }) => (
  <svg {...base(size)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/* Brand mark — fan roundel in bronze on charcoal, engineering register. */
export const BrandMark = ({ size = 38 }) => (
  <svg width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden="true">
    <circle cx="22" cy="22" r="20" stroke="#8A5A24" strokeWidth="2.4" />
    <circle cx="22" cy="22" r="15.5" stroke="#B0763A" strokeWidth="1.2" strokeDasharray="3 3" />
    <g stroke="#211C15" strokeWidth="2" strokeLinecap="round">
      <path d="M22 22c-4-1.5-6.5-5-5-8.5 1.6-3.6 6.5-2.6 7.5 1.5" />
      <path d="M22 22c4 1.5 6.5 5 5 8.5-1.6 3.6-6.5 2.6-7.5-1.5" />
      <path d="M22 22c-1.5-4-5-6.5-8.5-5-3.6 1.6-2.6 6.5 1.5 7.5" />
      <path d="M22 22c1.5 4 5 6.5 8.5 5 3.6-1.6 2.6-6.5-1.5-7.5" />
    </g>
    <circle cx="22" cy="22" r="2.6" fill="#8A5A24" />
  </svg>
);
