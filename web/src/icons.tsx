// Custom 15px-class icon set drawn in a light 1.5px stroke style.
import type { CSSProperties } from 'react';

type P = { size?: number; className?: string; style?: CSSProperties };
const S = ({ size = 15, className, style, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 15 15" fill="none" className={className} style={style}>
    {children}
  </svg>
);
const stroke = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

/* ---------- workflow state glyphs ---------- */
export const StatusBacklog = (p: P) => (
  <S {...p}><circle cx="7.5" cy="7.5" r="5.4" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.4 2.1" fill="none" strokeLinecap="round" /></S>
);
export const StatusTodo = (p: P) => (
  <S {...p}><circle cx="7.5" cy="7.5" r="5.4" {...stroke} /></S>
);
export const StatusStarted = (p: P & { color?: string }) => (
  <S {...p}>
    <circle cx="7.5" cy="7.5" r="5.4" stroke="currentColor" strokeWidth="1.4" fill="none" />
    <path d="M7.5 2.1 A5.4 5.4 0 0 1 7.5 12.9 Z" fill="currentColor" stroke="none" />
  </S>
);
export const StatusDone = (p: P) => (
  <S {...p}>
    <circle cx="7.5" cy="7.5" r="6.1" fill="currentColor" />
    <path d="M4.8 7.7 L6.7 9.5 L10.3 5.6" stroke="var(--bg-overlay, #1a1a1b)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </S>
);
export const StatusCanceled = (p: P) => (
  <S {...p}>
    <circle cx="7.5" cy="7.5" r="5.4" stroke="currentColor" strokeWidth="1.4" fill="none" />
    <path d="M5.5 5.5 L9.5 9.5 M9.5 5.5 L5.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);

/* ---------- priority glyphs ---------- */
export const PrioNone = (p: P) => (
  <S {...p}>
    <circle cx="3.4" cy="7.5" r="0.9" fill="currentColor" />
    <circle cx="7.5" cy="7.5" r="0.9" fill="currentColor" />
    <circle cx="11.6" cy="7.5" r="0.9" fill="currentColor" />
  </S>
);
export const PrioUrgent = (p: P) => (
  <S {...p}>
    <rect x="2.6" y="2.6" width="9.8" height="9.8" rx="2.4" fill="currentColor" />
    <circle cx="7.5" cy="7.5" r="1.5" fill="var(--bg-overlay, #1a1a1b)" />
  </S>
);
const bar = (x: number, h: number) => <rect x={x} y={12.2 - h} width="2.4" height={h} rx="1" fill="currentColor" />;
export const PrioHigh = (p: P) => <S {...p}>{bar(2.7, 9.6)}{bar(6.3, 6.4)}{bar(9.9, 3.4)}</S>;
export const PrioMedium = (p: P) => <S {...p}>{bar(2.7, 9.6)}{bar(6.3, 6.4)}<rect x="9.9" y="9.2" width="2.4" height="3" rx="1" fill="currentColor" opacity="0.35" /></S>;
export const PrioLow = (p: P) => <S {...p}>{bar(2.7, 9.6)}<rect x="6.3" y="9.2" width="2.4" height="3" rx="1" fill="currentColor" opacity="0.35" /><rect x="9.9" y="9.2" width="2.4" height="3" rx="1" fill="currentColor" opacity="0.35" /></S>;

/* ---------- ui icons ---------- */
export const IconInbox = (p: P) => <S {...p}><path d="M2.2 8.2h3l1 1.8h2.6l1-1.8h3" {...stroke} /><path d="M3.4 3.4h8.2l1.2 4.8v3.4H2.2V8.2l1.2-4.8Z" {...stroke} /></S>;
export const IconMyIssues = (p: P) => <S {...p}><path d="M3.2 3.6c2.9-1.4 5.7-1.4 8.6 0v7.8c-2.9-1.4-5.7-1.4-8.6 0V3.6Z" {...stroke} /><path d="M3.2 3.6v7.8" {...stroke} /></S>;
export const IconSparkle = (p: P) => <S {...p}><path d="M7.5 2.2 8.6 6l3.8 1.1-3.8 1.1-1.1 3.8-1.1-3.8L2.6 7.1 6.4 6l1.1-3.8Z" {...stroke} /></S>;
export const IconBox = (p: P) => <S {...p}><path d="M7.5 2.2 13 5.2v4.6l-5.5 3L2 9.8V5.2l5.5-3Z" {...stroke} /><path d="M2.3 5.4 7.5 8.2l5.2-2.8M7.5 8.2v4.6" {...stroke} /></S>;
export const IconViews = (p: P) => <S {...p}><path d="M2.4 5.2 7.5 2.4l5.1 2.8-5.1 2.8-5.1-2.8Z" {...stroke} /><path d="M2.4 8.2l5.1 2.8 5.1-2.8" {...stroke} /><path d="M2.4 10.8l5.1 2.8 5.1-2.8" {...stroke} opacity="0.5" /></S>;
export const IconTeam = (p: P) => <S {...p}><rect x="2.6" y="2.6" width="9.8" height="9.8" rx="2.4" {...stroke} /><circle cx="7.5" cy="6.3" r="1.7" {...stroke} /><path d="M4.6 11.4c.5-1.7 1.6-2.5 2.9-2.5s2.4.8 2.9 2.5" {...stroke} /></S>;
export const IconHome = (p: P) => <S {...p}><path d="M2.8 6.4 7.5 2.6l4.7 3.8v5.8H2.8V6.4Z" {...stroke} /><path d="M6.1 12.2V8.9h2.8v3.3" {...stroke} /></S>;
export const IconIssues = (p: P) => <S {...p}><rect x="2.6" y="2.6" width="9.8" height="9.8" rx="2.2" {...stroke} /><circle cx="7.5" cy="7.5" r="1.6" fill="currentColor" /></S>;
export const IconSearch = (p: P) => <S {...p}><circle cx="6.7" cy="6.7" r="4.1" {...stroke} /><path d="m9.9 9.9 2.8 2.8" {...stroke} /></S>;
export const IconPlus = (p: P) => <S {...p}><path d="M7.5 3v9M3 7.5h9" {...stroke} /></S>;
export const IconNew = (p: P) => <S {...p}><path d="M9.2 2.9l2.9 2.9-6.6 6.6H2.6V9.5l6.6-6.6Z" {...stroke} /></S>;
export const IconSettings = (p: P) => <S {...p}><circle cx="7.5" cy="7.5" r="1.9" {...stroke} /><path d="M7.5 2.2v1.6M7.5 11.2v1.6M2.2 7.5h1.6M11.2 7.5h1.6M3.8 3.8l1.1 1.1M10.1 10.1l1.1 1.1M11.2 3.8l-1.1 1.1M4.9 10.1l-1.1 1.1" {...stroke} /></S>;
export const IconChevronDown = (p: P) => <S {...p}><path d="m4.5 6.2 3 3 3-3" {...stroke} /></S>;
export const IconChevronRight = (p: P) => <S {...p}><path d="m6.2 4.5 3 3-3 3" {...stroke} /></S>;
export const IconStar = (p: P & { filled?: boolean }) => (
  <S {...p}><path d="M7.5 2.2 9.1 5.6l3.7.5-2.7 2.6.6 3.7L7.5 10.6l-3.2 1.8.6-3.7L2.2 6.1l3.7-.5L7.5 2.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill={p.filled ? 'currentColor' : 'none'} /></S>
);
export const IconBell = (p: P) => <S {...p}><path d="M7.5 2.4c-2 0-3.3 1.5-3.3 3.4 0 2.4-1 3.3-1.4 3.9h9.4c-.4-.6-1.4-1.5-1.4-3.9 0-1.9-1.3-3.4-3.3-3.4Z" {...stroke} /><path d="M6.3 12.2c.2.7.7 1.1 1.2 1.1s1-.4 1.2-1.1" {...stroke} /></S>;
export const IconFilter = (p: P) => <S {...p}><path d="M2.6 3.6h9.8M4.4 7.5h6.2M6.2 11.4h2.6" {...stroke} /></S>;
export const IconDisplay = (p: P) => <S {...p}><path d="M2.6 4.4h9.8M2.6 10.6h9.8" {...stroke} /><path d="M4 7.5h7" {...stroke} opacity="0.5" /><path d="M9.8 2.9l1.5 1.5-1.5 1.5M5.2 9.1 3.7 10.6l1.5 1.5" {...stroke} /></S>;
export const IconPanel = (p: P) => <S {...p}><rect x="2.2" y="2.8" width="10.6" height="9.4" rx="2" {...stroke} /><path d="M9.4 2.8v9.4" {...stroke} /></S>;
export const IconMore = (p: P) => <S {...p}><circle cx="3.6" cy="7.5" r="1" fill="currentColor" /><circle cx="7.5" cy="7.5" r="1" fill="currentColor" /><circle cx="11.4" cy="7.5" r="1" fill="currentColor" /></S>;
export const IconClose = (p: P) => <S {...p}><path d="m3.8 3.8 7.4 7.4M11.2 3.8l-7.4 7.4" {...stroke} /></S>;
export const IconExpand = (p: P) => <S {...p}><path d="M8.8 2.9h3.3v3.3M6.2 12.1H2.9V8.8M12.1 2.9 8.6 6.4M2.9 12.1l3.5-3.5" {...stroke} /></S>;
export const IconCopy = (p: P) => <S {...p}><rect x="5.2" y="5.2" width="7.2" height="7.2" rx="1.8" {...stroke} /><path d="M9.8 5.2V4.2a1.6 1.6 0 0 0-1.6-1.6H4.2a1.6 1.6 0 0 0-1.6 1.6v4A1.6 1.6 0 0 0 4.2 9.8h1" {...stroke} /></S>;
export const IconLink = (p: P) => <S {...p}><path d="M6.3 8.7 8.7 6.3" {...stroke} /><path d="M7.9 4.6 9.3 3.2a2.4 2.4 0 0 1 3.4 3.4l-1.4 1.4M7.1 10.4 5.7 11.8a2.4 2.4 0 0 1-3.4-3.4l1.4-1.4" {...stroke} /></S>;
export const IconAttach = (p: P) => <S {...p}><path d="m8.2 4.4 2.4 2.4-4.7 4.7c-1 1-2.4 1-3.1.3-.7-.7-.7-2.1.3-3.1l5-5c.7-.7 1.7-.7 2.2-.2.5.5.5 1.5-.2 2.2l-4.6 4.6" {...stroke} /></S>;
export const IconEmoji = (p: P) => <S {...p}><circle cx="7.5" cy="7.5" r="5.4" {...stroke} /><path d="M5.4 9.1c.5.8 1.3 1.2 2.1 1.2s1.6-.4 2.1-1.2" {...stroke} /><circle cx="5.6" cy="6" r="0.8" fill="currentColor" /><circle cx="9.4" cy="6" r="0.8" fill="currentColor" /></S>;
export const IconArrowUp = (p: P) => <S {...p}><path d="M7.5 12V3M3.8 6.7 7.5 3l3.7 3.7" {...stroke} /></S>;
export const IconCheck = (p: P) => <S {...p}><path d="m3.4 7.9 2.7 2.7 5.5-6.2" {...stroke} /></S>;
export const IconTextAa = (p: P) => <S {...p}><path d="M2.4 11.5 5.6 3.5l3.2 8M3.5 9h4.2" {...stroke} /><path d="M11.1 11.5c.9 0 1.5-.5 1.5-1.6V6.6h-2.8M12.6 8.8c-2.2-.4-3 .2-3 1.2 0 .9.8 1.5 1.6 1.5.6 0 1.1-.2 1.4-.7" {...stroke} /></S>;
export const IconSplit = (p: P) => <S {...p}><rect x="2.2" y="2.8" width="10.6" height="9.4" rx="2" {...stroke} /><path d="M7.5 2.8v9.4" {...stroke} /></S>;
export const IconSidebarCollapse = IconPanel;
export const IconBack = (p: P) => <S {...p}><path d="M9.6 3.4 5.4 7.5l4.2 4.1" {...stroke} /></S>;
export const IconDrag = (p: P) => <S {...p}><circle cx="5.4" cy="4" r="1" fill="currentColor" /><circle cx="9.6" cy="4" r="1" fill="currentColor" /><circle cx="5.4" cy="7.5" r="1" fill="currentColor" /><circle cx="9.6" cy="7.5" r="1" fill="currentColor" /><circle cx="5.4" cy="11" r="1" fill="currentColor" /><circle cx="9.6" cy="11" r="1" fill="currentColor" /></S>;
export const IconCalendar = (p: P) => <S {...p}><rect x="2.6" y="3.4" width="9.8" height="9" rx="2" {...stroke} /><path d="M2.6 6.4h9.8M5.4 2.4v2M9.6 2.4v2" {...stroke} /></S>;
export const IconUser = (p: P) => <S {...p}><circle cx="7.5" cy="5.3" r="2.4" {...stroke} /><path d="M3 12.4c.7-2.2 2.4-3.3 4.5-3.3s3.8 1.1 4.5 3.3" {...stroke} /></S>;
export const IconUsers = (p: P) => <S {...p}><circle cx="5.6" cy="5.6" r="2.1" {...stroke} /><path d="M1.9 12c.6-1.9 2-2.8 3.7-2.8s3.1.9 3.7 2.8" {...stroke} /><circle cx="10.6" cy="5.2" r="1.7" {...stroke} /><path d="M10.3 8.9c1.5.1 2.6 1 3.1 2.6" {...stroke} /></S>;
export const IconDoc = (p: P) => <S {...p}><path d="M3.6 2.4h5.2L12 5.6v7H3.6v-10.2Z" {...stroke} /><path d="M8.6 2.6V5.8H12" {...stroke} /><path d="M5.6 8.2h3.8M5.6 10.4h3.8" {...stroke} /></S>;
export const IconTarget = (p: P) => <S {...p}><circle cx="7.5" cy="7.5" r="5.2" {...stroke} /><circle cx="7.5" cy="7.5" r="2.2" {...stroke} /><circle cx="7.5" cy="7.5" r="0.7" fill="currentColor" /></S>;
export const IconTag = (p: P) => <S {...p}><path d="M8.2 2.6H12.4v4.2l-6 6a1.7 1.7 0 0 1-2.4 0L2.6 11.4a1.7 1.7 0 0 1 0-2.4l5.6-6.4Z" {...stroke} /><circle cx="9.6" cy="5.4" r="1" fill="currentColor" /></S>;

/* ---------- additions for full feature coverage ---------- */
export const IconComment = (p: P) => <S {...p}><path d="M12.4 9.4a1.8 1.8 0 0 1-1.8 1.8H5.4L2.6 13.4V4.4a1.8 1.8 0 0 1 1.8-1.8h6.2a1.8 1.8 0 0 1 1.8 1.8v5Z" {...stroke} /></S>;
export const IconMention = (p: P) => <S {...p}><circle cx="7.5" cy="7.5" r="5.2" {...stroke} /><circle cx="7.5" cy="7.5" r="2" {...stroke} /><path d="M9.5 7.5c0 1.4.6 2.1 1.5 2.1 1 0 1.7-.9 1.7-2.1a5.2 5.2 0 1 0-2 4.1" {...stroke} /></S>;
export const IconAssignArrow = (p: P) => <S {...p}><path d="M2.8 7.5h9M8.4 4.2l3.3 3.3-3.3 3.3" {...stroke} /></S>;
export const IconBlocked = (p: P) => <S {...p}><circle cx="7.5" cy="7.5" r="5.2" {...stroke} /><path d="M3.8 3.8 11.2 11.2" {...stroke} /></S>;
export const IconBlocks = (p: P) => <S {...p}><circle cx="4.6" cy="10.4" r="2.4" {...stroke} /><rect x="8.4" y="2.4" width="4.4" height="4.4" rx="1.2" {...stroke} /><path d="M4.6 8V6.4a2 2 0 0 1 2-2h1.8" {...stroke} /></S>;
export const IconRelated = (p: P) => <S {...p}><path d="M6.3 4.4H4a1.8 1.8 0 0 0-1.8 1.8v2.6A1.8 1.8 0 0 0 4 10.6h2.3M8.7 4.4H11a1.8 1.8 0 0 1 1.8 1.8v2.6a1.8 1.8 0 0 1-1.8 1.8H8.7" {...stroke} /></S>;
export const IconDuplicate = (p: P) => <S {...p}><rect x="5.4" y="5.4" width="7" height="7" rx="1.8" {...stroke} /><path d="M9.8 5.4V4.2a1.6 1.6 0 0 0-1.6-1.6H4.2A1.6 1.6 0 0 0 2.6 4.2v4a1.6 1.6 0 0 0 1.6 1.6h1.2" {...stroke} /></S>;
export const IconArchive = (p: P) => <S {...p}><rect x="2.4" y="2.8" width="10.2" height="3" rx="1" {...stroke} /><path d="M3.4 5.8v5.6a1.6 1.6 0 0 0 1.6 1.6h5a1.6 1.6 0 0 0 1.6-1.6V5.8M6 8.4h3" {...stroke} /></S>;
export const IconTrash = (p: P) => <S {...p}><path d="M2.8 4h9.4M6.2 4V2.8h2.6V4M4.2 4l.5 8.2h5.6L10.8 4M6.3 6.4v3.8M8.7 6.4v3.8" {...stroke} /></S>;
export const IconRestore = (p: P) => <S {...p}><path d="M2.6 6.4A5.2 5.2 0 1 1 2.3 9" {...stroke} /><path d="M2.4 3.4v3h3" {...stroke} /></S>;
export const IconMoon = (p: P) => <S {...p}><path d="M12.6 9.2A5.4 5.4 0 0 1 5.8 2.4a5.4 5.4 0 1 0 6.8 6.8Z" {...stroke} /></S>;
export const IconSun = (p: P) => <S {...p}><circle cx="7.5" cy="7.5" r="2.8" {...stroke} /><path d="M7.5 1.9v1.4M7.5 11.7v1.4M1.9 7.5h1.4M11.7 7.5h1.4M3.5 3.5l1 1M10.5 10.5l1 1M11.5 3.5l-1 1M4.5 10.5l-1 1" {...stroke} /></S>;
export const IconCycle = (p: P) => <S {...p}><path d="M12.4 7.5a4.9 4.9 0 1 1-1.6-3.6" {...stroke} /><path d="M11 1.9v2.2H8.8" {...stroke} /></S>;
export const IconEstimate = (p: P) => <S {...p}><circle cx="7.5" cy="7.5" r="5.2" {...stroke} /><path d="M7.5 4.6v3.1l2 1.4" {...stroke} /></S>;
export const IconSubIssue = (p: P) => <S {...p}><path d="M3.4 2.8v7a2 2 0 0 0 2 2h6.2" {...stroke} /><circle cx="3.4" cy="3.4" r="1" fill="currentColor" /></S>;
export const IconEdit = (p: P) => <S {...p}><path d="M8.9 3.2l2.9 2.9-6.4 6.4-3.3.4.4-3.3 6.4-6.4Z" {...stroke} /></S>;
export const IconFocus = (p: P) => <S {...p}><circle cx="7.5" cy="7.5" r="5.2" {...stroke} /><circle cx="7.5" cy="7.5" r="1.6" fill="currentColor" /></S>;
export const IconGauge = (p: P) => <S {...p}><path d="M2.6 10.5a5.2 5.2 0 1 1 9.8 0" {...stroke} /><path d="M7.5 7.5 9.6 5" {...stroke} /></S>;
export const IconInboxArrow = (p: P) => <S {...p}><path d="M2.6 7.5h9.8M9 4.1l3.4 3.4L9 10.9" {...stroke} /></S>;
export const IconBot = (p: P) => <S {...p}><rect x="2.8" y="4.4" width="9.4" height="7.6" rx="2" {...stroke} /><path d="M7.5 2.2v2.2" {...stroke} /><circle cx="5.4" cy="8.2" r="0.9" fill="currentColor" /><circle cx="9.6" cy="8.2" r="0.9" fill="currentColor" /><path d="M6 10.6h3" {...stroke} /></S>;
export const IconPrompt = (p: P) => <S {...p}><path d="M4.6 4.4 2 7.5l2.6 3.1M10.4 4.4 13 7.5l-2.6 3.1" {...stroke} /><path d="m8.4 3.4-1.8 8.2" {...stroke} /></S>;
