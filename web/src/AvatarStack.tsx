
type Person = { name: string; initials: string; color: string };

export function AvatarStack({
  people,
  size = 20,
  overlap = 0.3,
  gap = 0.25,
}: { people: Person[]; size?: number; overlap?: number; gap?: number }) {
  if (people.length === 0) return null;
  const r = size / 2;
  const step = size * (1 - overlap);
  const w = size + step * (people.length - 1);
  const holeR = r * (1 + gap);
  const uid = `bl-av-${people.map(p => p.initials).join('')}-${size}`;

  return (
    <svg width={w} height={size} viewBox={`0 0 ${w} ${size}`} style={{ flex: 'none' }}
         role="img" aria-label={people.map(p => p.name).join(', ')}>
      <defs>
        {people.slice(1).map((_, i) => (
          <mask key={i} id={`${uid}-cut-${i}`}>
            <rect width={w} height={size} fill="#fff" />
            <circle cx={r + step * (i + 1)} cy={r} r={holeR} fill="#000" />
          </mask>
        ))}
      </defs>
      {people.map((p, i) => {
        const cx = r + step * i;
        const body = (
          <>
            <circle cx={cx} cy={r} r={r} fill={p.color} />
            <text x={cx} y={r + size * 0.155} textAnchor="middle" fill="#fff"
                  fontFamily="var(--font-ui)" fontSize={size * 0.42} fontWeight={600}>
              {p.initials}
            </text>
          </>
        );
        return i === people.length - 1
          ? <g key={i}>{body}</g>
          : <g key={i} mask={`url(#${uid}-cut-${i})`}>{body}</g>;
      })}
    </svg>
  );
}

export function SubIssueSpine({ rows, rowH = 30, top = 15, width = 20 }: {
  rows: { active?: boolean }[]; rowH?: number; top?: number; width?: number;
}) {
  const h = top + rowH * (rows.length - 1) + top;
  const cx = width / 2;
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} style={{ flex: 'none' }} aria-hidden="true">
      <defs>
        <mask id="bl-spine">
          <rect width={width} height={h} fill="#fff" />
          {rows.map((_, i) => <circle key={i} cx={cx} cy={top + rowH * i} r={9} fill="#000" />)}
        </mask>
      </defs>
      <rect x={cx - 0.5} y={0} width={1} height={h} fill="currentColor" fillOpacity={0.14} mask="url(#bl-spine)" />
      {rows.map((r, i) => (
        <circle key={i} cx={cx} cy={top + rowH * i} r={3.4}
                fill={r.active ? 'var(--brand-register)' : 'var(--text-secondary)'} />
      ))}
    </svg>
  );
}
