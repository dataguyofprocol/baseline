/* Empty-state illustrations in Linear's style: thin ink line art where every object is a "slab" —
   the outline drawn twice, the copy below in a lighter ink, so flat shapes read as thick tiles.
   Colors come from --illo-ink / --illo-shade / --illo-fill, so both themes work. */

export type IllustrationName =
  | 'initiatives' | 'views' | 'projects' | 'issues' | 'inbox' | 'cycles' | 'updates' | 'search'
  | 'archive' | 'trash' | 'customers' | 'drafts' | 'triage' | 'docs' | 'asks' | 'activity';

const INK = 'var(--illo-ink)';
const SHADE = 'var(--illo-shade)';
const FILL = 'var(--illo-fill)';
const line = { stroke: INK, strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

/** a rounded rectangle with depth */
function Slab({ x, y, w, h, r = 6, d = 4 }: { x: number; y: number; w: number; h: number; r?: number; d?: number }) {
  return (
    <>
      <rect x={x} y={y + d} width={w} height={h} rx={r} fill={FILL} stroke={SHADE} strokeWidth="1.5" />
      <rect x={x} y={y} width={w} height={h} rx={r} fill={FILL} stroke={INK} strokeWidth="1.5" />
    </>
  );
}
/** any path, with depth */
function Solid({ d, depth = 4 }: { d: string; depth?: number }) {
  return (
    <>
      <path d={d} transform={`translate(0 ${depth})`} fill={FILL} stroke={SHADE} strokeWidth="1.5" strokeLinejoin="round" />
      <path d={d} fill={FILL} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
    </>
  );
}
const Dots = ({ x, y }: { x: number; y: number }) => (
  <>{[0, 1, 2].map(i => <circle key={i} cx={x + i * 6} cy={y} r="1.6" fill={INK} opacity={1 - i * 0.32} />)}</>
);
const Text = ({ x, y, w, o = 1 }: { x: number; y: number; w: number; o?: number }) => <path d={`M${x} ${y}h${w}`} {...line} opacity={o} />;
const Arrowhead = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <path transform={`translate(${x} ${y}) scale(${s})`} d="M0-6 5.4 5.6a.5.5 0 0 1-.7.6L.3 3.9a.6.6 0 0 0-.6 0L-4.7 6.2a.5.5 0 0 1-.7-.6L0-6Z" fill={INK} />
);

const ART: Record<IllustrationName, React.ReactNode> = {
  initiatives: (
    <>
      <Slab x={8} y={6} w={88} h={22} r={11} /><Arrowhead x={22} y={17} /><Dots x={76} y={17} />
      <Slab x={28} y={34} w={88} h={22} r={11} /><Arrowhead x={42} y={45} /><Dots x={96} y={45} />
      <Slab x={8} y={62} w={88} h={22} r={11} /><Arrowhead x={22} y={73} /><Dots x={76} y={73} />
    </>
  ),
  views: (
    <>
      {[16, 12, 8].map((o, i) => <path key={o} d={`M60 ${50 + o} 98 ${68 + o} 60 ${86 + o} 22 ${68 + o}Z`} fill={FILL} stroke={SHADE} strokeWidth="1.5" strokeLinejoin="round" opacity={0.45 + i * 0.25} />)}
      <path d="M60 50 98 68 60 86 22 68Z" fill={FILL} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
      <g transform="rotate(-26 60 30)"><Slab x={36} y={12} w={48} h={34} r={4} d={3} /></g>
    </>
  ),
  projects: (
    <>
      <Slab x={12} y={8} w={100} h={78} r={8} />
      <path d="M22 24h30" {...line} /><Dots x={92} y={24} />
      {[40, 56, 72].map((y, i) => (
        <g key={y}>
          <circle cx="26" cy={y} r="4.5" {...line} />
          {i < 2 && <path d={`M26 ${y - 4.5}a4.5 4.5 0 0 1 ${i === 0 ? '0 9' : '4.5 4.5'}`} {...line} strokeWidth="3" />}
          <rect x="38" y={y - 2.5} width="64" height="5" rx="2.5" fill="none" stroke={SHADE} strokeWidth="1.5" />
          <rect x="38" y={y - 2.5} width={[52, 30, 12][i]} height="5" rx="2.5" fill={INK} />
        </g>
      ))}
    </>
  ),
  issues: (
    <>
      {[8, 36, 64].map((y, i) => (
        <g key={y}>
          <Slab x={10} y={y} w={104} h={22} r={6} />
          <circle cx="24" cy={y + 11} r="5" {...line} strokeDasharray={i === 0 ? '2.4 2' : undefined} />
          {i === 1 && <path d={`M24 ${y + 6}a5 5 0 0 1 0 10Z`} fill={INK} />}
          {i === 2 && <path d={`m21.4 ${y + 11.2} 1.9 1.9 3.4-3.6`} {...line} />}
          <Text x={36} y={y + 11} w={[46, 58, 34][i]} />
          <circle cx="102" cy={y + 11} r="3.5" fill={SHADE} />
        </g>
      ))}
    </>
  ),
  inbox: (
    <>
      <g transform="rotate(-8 62 28)"><Slab x={34} y={8} w={56} h={36} r={5} d={3} /><circle cx="46" cy="20" r="4" {...line} /><Text x={56} y={20} w={24} /><Text x={44} y={32} w={36} o={0.5} /></g>
      <Solid d="M12 52h28l6 10h32l6-10h28v30a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6Z" />
    </>
  ),
  cycles: (
    <>
      {[0, 1, 2].map(i => (
        <g key={i} transform={`rotate(${i * 120} 62 48)`}>
          <path d="M62 14a34 34 0 0 1 29 16.5" transform="translate(0 4)" fill="none" stroke={SHADE} strokeWidth="7" strokeLinecap="round" />
          <path d="M62 14a34 34 0 0 1 29 16.5" fill="none" stroke={INK} strokeWidth="7" strokeLinecap="round" opacity={1 - i * 0.28} />
          <path d="M62 14a34 34 0 0 1 29 16.5" fill="none" stroke={FILL} strokeWidth="3.6" strokeLinecap="round" />
        </g>
      ))}
      <circle cx="62" cy="48" r="9" {...line} /><path d="M62 43v5l3 2" {...line} />
    </>
  ),
  updates: (
    <>
      <g opacity="0.7"><Slab x={30} y={6} w={84} h={50} r={8} /></g>
      <Slab x={10} y={26} w={90} h={58} r={8} />
      <circle cx="26" cy="42" r="6" fill={INK} opacity="0.16" /><path d="m22 44 3-3 2 1.6 3.4-3.6" {...line} />
      <Text x={38} y={42} w={30} /><Text x={20} y={58} w={68} o={0.55} /><Text x={20} y={70} w={48} o={0.55} />
    </>
  ),
  search: (
    <>
      <Slab x={10} y={12} w={80} h={20} r={10} /><Text x={24} y={22} w={36} o={0.5} />
      <Slab x={10} y={42} w={64} h={20} r={10} /><Text x={24} y={52} w={24} o={0.5} />
      <circle cx="86" cy="58" r="17" transform="translate(0 4)" fill={FILL} stroke={SHADE} strokeWidth="1.5" />
      <circle cx="86" cy="58" r="17" fill={FILL} stroke={INK} strokeWidth="1.5" />
      <circle cx="86" cy="58" r="9" {...line} /><path d="m98 70 12 12" stroke={INK} strokeWidth="5" strokeLinecap="round" />
    </>
  ),
  archive: (
    <>
      <Slab x={14} y={34} w={96} h={50} r={6} />
      <Slab x={8} y={14} w={108} h={18} r={5} d={3} />
      <rect x="48" y="46" width="28" height="8" rx="4" {...line} />
    </>
  ),
  trash: (
    <>
      <Solid d="M28 30h68l-6 54a6 6 0 0 1-6 5H40a6 6 0 0 1-6-5Z" />
      <Slab x={20} y={16} w={84} h={10} r={5} d={3} /><path d="M50 16v-4a3 3 0 0 1 3-3h18a3 3 0 0 1 3 3v4" {...line} />
      <path d="M50 42v34M62 42v34M74 42v34" {...line} opacity="0.55" />
    </>
  ),
  customers: (
    <>
      <circle cx="78" cy="30" r="13" transform="translate(0 4)" fill={FILL} stroke={SHADE} strokeWidth="1.5" /><circle cx="78" cy="30" r="13" fill={FILL} stroke={INK} strokeWidth="1.5" opacity="0.75" />
      <Solid d="M56 84a22 22 0 0 1 44 0Z" />
      <circle cx="46" cy="34" r="15" transform="translate(0 4)" fill={FILL} stroke={SHADE} strokeWidth="1.5" /><circle cx="46" cy="34" r="15" fill={FILL} stroke={INK} strokeWidth="1.5" />
      <Solid d="M20 86a26 26 0 0 1 52 0Z" />
    </>
  ),
  drafts: (
    <>
      <Solid d="M22 8h50l18 18v58a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4Z" />
      <path d="M72 8v14a4 4 0 0 0 4 4h14" {...line} />
      <Text x={30} y={40} w={40} /><Text x={30} y={52} w={48} o={0.5} /><Text x={30} y={64} w={28} o={0.5} />
      <g transform="rotate(40 98 58)"><Slab x={92} y={26} w={12} h={52} r={3} d={3} /><path d="M92 78l6 10 6-10" {...line} fill={FILL} /></g>
    </>
  ),
  triage: (
    <>
      <Solid d="M14 10h96l-36 38v30l-24 10V48Z" />
      <path d="M26 22h72" {...line} opacity="0.5" />
    </>
  ),
  docs: (
    <>
      <g opacity="0.6"><Slab x={36} y={6} w={66} h={80} r={6} /></g>
      <Slab x={20} y={12} w={66} h={80} r={6} />
      <Text x={30} y={28} w={30} /><Text x={30} y={42} w={44} o={0.5} /><Text x={30} y={52} w={40} o={0.5} /><Text x={30} y={62} w={46} o={0.5} /><Text x={30} y={72} w={24} o={0.5} />
    </>
  ),
  asks: (
    <>
      <Solid d="M14 14a8 8 0 0 1 8-8h80a8 8 0 0 1 8 8v44a8 8 0 0 1-8 8H48L28 82V66h-6a8 8 0 0 1-8-8Z" />
      <rect x="26" y="20" width="72" height="10" rx="3" {...line} opacity="0.6" /><rect x="26" y="38" width="72" height="16" rx="3" {...line} opacity="0.6" />
    </>
  ),
  activity: (
    <>
      <path d="M26 8v80" stroke={SHADE} strokeWidth="1.5" />
      {[16, 44, 72].map((y, i) => (
        <g key={y}>
          <circle cx="26" cy={y} r="5" fill={FILL} stroke={INK} strokeWidth="1.5" />
          <Slab x={40} y={y - 10} w={[72, 56, 64][i]} h={20} r={6} d={3} />
          <Text x={50} y={y} w={[40, 26, 34][i]} o={0.6} />
        </g>
      ))}
    </>
  ),
};

export function Illustration({ name, small = false }: { name: IllustrationName; small?: boolean }) {
  return (
    <svg className={`illo${small ? ' small' : ''}`} viewBox="0 0 124 96" width={small ? 84 : 124} height={small ? 65 : 96} aria-hidden="true">
      {ART[name]}
    </svg>
  );
}
