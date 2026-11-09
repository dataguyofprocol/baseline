// The mark: a rule with a node cut out of it, the datum that work is measured against.
// The node is knocked out of the rule (a paper-coloured gap), never stroked on top.
// Two cuts, not one scaled mark: >=24px keeps the register line and the 7.6 radius;
// <24px drops the register line, thickens the rule 1.9 -> 2.6 and tightens radius to 6.4.
// The small cut also opens the gap wider than a scaled-down large cut would (1.8 grid
// units, not 1.2) and centres the node at 14 rather than 12.6: at 16px a 1.2-unit gap
// lands on 0.6 device px and greys out, and a node further left leaves a rule stub too
// short to read. Every part of the small cut is >= 1 device px at 16. The tab bar uses
// this cut, so it must stay legible there.
// Grounds stay flat at any size, with no gradient, sheen or glow.

export function Logo({ size = 18, tone = 'ink' }: { size?: number; tone?: 'ink' | 'paper' }) {
  const small = size < 24;
  const paper = tone === 'paper';
  const uid = (small ? 'bl-logo-s' : 'bl-logo-l') + (paper ? '-p' : '');
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
          <circle cx={nodeCx} cy={cy} r={gapR} fill="#000" />
        </mask>
      </defs>
      {/* the paper cut inverts only the ground. Geometry, register line and the
          knocked-out gap are identical; it is for ink-on-paper surfaces (print,
          export cards, a light marketing ground) */}
      <rect width="32" height="32" rx={small ? 6.4 : 7.6} fill={paper ? '#F3F1EC' : '#14151A'} />
      {!small && (
        <>
          <rect x={0.5} y={0.5} width={31} height={31} rx={7.2} fill="none" stroke={paper ? '#09090A' : '#fff'} strokeOpacity={paper ? 0.1 : 0.09} />
          <rect x={6} y={22.3} width={20} height={0.9} fill="#5E6AD2" />
        </>
      )}
      <g fill={paper ? '#14151A' : '#F3F1EC'}>
        <rect x={ruleX} y={ruleY} width={ruleW} height={rule} mask={`url(#${uid}-gap)`} />
        <circle cx={nodeCx} cy={cy} r={nodeR} />
      </g>
    </svg>
  );
}

// Containerless mark that inherits currentColor. The only illustration the product
// uses: empty states, watermarks, print.
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <mask id="bl-mark-gap">
          <rect width="32" height="32" fill="#fff" />
          <circle cx={11} cy={19.35} r={5.5} fill="#000" />
        </mask>
      </defs>
      <g fill="currentColor">
        <rect x={1.6} y={18.3} width={28.8} height={2.1} mask="url(#bl-mark-gap)" />
        <circle cx={11} cy={19.35} r={4.4} />
      </g>
    </svg>
  );
}

// Lockup: node + wordmark + one rule running under both and past the word.
// For sign-in and marketing only, never product chrome.
export function Lockup({ size = 44, tone = 'var(--brand-paper)' }: { size?: number; tone?: string }) {
  const dot = Math.round(size * 0.295);
  const ruleW = Math.round(size * 6.45);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: size * 0.25, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.295 }}>
        <span style={{ width: dot, height: dot, borderRadius: '50%', background: tone, flex: 'none' }} />
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: size,
            fontWeight: 590,
            letterSpacing: '-0.03em',
            lineHeight: 1,
            color: tone,
          }}
        >
          Baseline
        </span>
      </div>
      <div style={{ width: ruleW, height: Math.max(1.4, size * 0.045), background: tone }} />
    </div>
  );
}
