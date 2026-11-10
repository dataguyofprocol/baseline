import { useId } from 'react';

type Tone = 'theme' | 'ink' | 'paper';
const TONES: Record<Tone, { ground: string; fg: string; edge: string; edgeOpacity: number }> = {
  ink: { ground: '#14151A', fg: '#F3F1EC', edge: '#fff', edgeOpacity: 0.09 },
  paper: { ground: '#F3F1EC', fg: '#14151A', edge: '#09090A', edgeOpacity: 0.1 },
  theme: { ground: 'var(--logo-ground)', fg: 'var(--logo-fg)', edge: 'var(--logo-edge)', edgeOpacity: 1 },
};

export function Logo({ size = 18, tone = 'theme' }: { size?: number; tone?: Tone }) {
  const small = size < 24;
  const t = TONES[tone];
  // per instance: url(#id) resolves to the first match in the document, so a shared id would
  // point every logo at one mask and the hover slide would move a node without its gap
  const uid = (small ? 'bl-logo-s' : 'bl-logo-l') + '-' + tone + useId().replace(/:/g, '');
  const rule = small ? 2.6 : 1.9;
  const ruleX = small ? 4.4 : 6;
  const ruleW = small ? 23.2 : 20;
  const ruleY = small ? 18.3 : 18.6;
  const nodeCx = small ? 14.0 : 12.4;
  const nodeR = small ? 4.0 : 3.6;
  const gapR = small ? 6.0 : 4.7;
  const cy = ruleY + rule / 2;

  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <mask id={uid + '-gap'}>
          <rect width="32" height="32" fill="#fff" />
          <circle className="lg-node" cx={nodeCx} cy={cy} r={gapR} fill="#000" />
        </mask>
      </defs>
      <rect width="32" height="32" rx={small ? 6.4 : 7.6} style={{ fill: t.ground }} />
      {!small && (
        <>
          <rect x={0.5} y={0.5} width={31} height={31} rx={7.2} fill="none" style={{ stroke: t.edge }} strokeOpacity={t.edgeOpacity} />
          <rect x={6} y={22.3} width={20} height={0.9} fill="#5E6AD2" />
        </>
      )}
      <g style={{ fill: t.fg }}>
        <rect x={ruleX} y={ruleY} width={ruleW} height={rule} mask={`url(#${uid}-gap)`} />
        <circle className="lg-node" cx={nodeCx} cy={cy} r={nodeR} />
      </g>
    </svg>
  );
}
