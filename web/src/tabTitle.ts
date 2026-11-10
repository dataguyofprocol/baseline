const pages: Array<{ label: string }> = [];
let page = '';
let unread = 0;
let plainIcon: string | null = null;
let dottedIcon: string | null = null;

function render() {
  const base = page ? `${page} · Baseline` : 'Baseline';
  document.title = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
  void paintIcon(unread > 0);
}

function sync() {
  const next = pages[0]?.label ?? '';
  if (next === page) return;
  page = next;
  render();
}

export function holdPageTitle(label: string): { update: (label: string) => void; release: () => void } {
  const entry = { label };
  pages.push(entry);
  sync();
  return {
    update: l => { entry.label = l; sync(); },
    release: () => { const i = pages.indexOf(entry); if (i >= 0) pages.splice(i, 1); sync(); },
  };
}

export function setUnread(n: number) {
  if (n === unread) return;
  unread = n;
  render();
}

function dotted(src: string): Promise<string | null> {
  if (dottedIcon) return Promise.resolve(dottedIcon);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0, 64, 64);
        g.globalCompositeOperation = 'destination-out';
        g.beginPath(); g.arc(50, 14, 17, 0, Math.PI * 2); g.fill();
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = '#5e6ad2';
        g.beginPath(); g.arc(50, 14, 12, 0, Math.PI * 2); g.fill();
        dottedIcon = c.toDataURL('image/png');
        resolve(dottedIcon);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function paintIcon(dot: boolean) {
  const svg = document.querySelector<HTMLLinkElement>('link[rel="icon"][data-live]')
    ?? document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
  if (!svg) return;
  svg.dataset.live = '';
  plainIcon ??= svg.getAttribute('href');
  if (!plainIcon) return;
  if (!dot) { svg.href = plainIcon; svg.type = 'image/svg+xml'; return; }
  const url = await dotted(plainIcon);
  if (url && unread > 0) { svg.href = url; svg.type = 'image/png'; }
}
