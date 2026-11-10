// Mentions in markdown. The editor stores `@[Ada Osei](user:u_123)`: the id makes it
// unambiguous when two people share a name, and the text still reads as "@Ada Osei" to an agent
// reading the raw markdown. Plain `@Ada Osei` (typed through the CLI, or written before ids)
// still counts, but only when exactly one person has that name.

export const MENTION_RE = /@\[([^\]\n]{1,80})\]\(user:([A-Za-z0-9_]{1,64})\)/g;

export function mentionToken(name: string, userId: string): string {
  return `@[${name.replace(/[[\]\n]/g, '')}](user:${userId})`;
}

/** the text with every mention token read back as plain "@Name" (inbox lines, emails, prompts) */
export function plainMentions(text: string): string {
  return text.replace(MENTION_RE, (_m, name: string) => `@${name}`);
}

/** markdown read back as one line of plain text, for previews (inbox rows): mentions as "@Name",
 *  and no emphasis marks, headings, list markers, code ticks or link targets */
export function plainText(md: string): string {
  return plainMentions(md)
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/gm, '')
    .replace(/(\*\*|__|~~)(?=\S)([^]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](?=\S)([^*_\n]*?\S)[*_](?![\w*])/g, '$1$2')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** people with exactly one holder of their name (case-insensitive), the only names a plain "@Name" can mean */
export function uniquelyNamed<U extends { name: string }>(users: U[]): U[] {
  const count = new Map<string, number>();
  for (const u of users) count.set(u.name.toLowerCase(), (count.get(u.name.toLowerCase()) ?? 0) + 1);
  return users.filter(u => count.get(u.name.toLowerCase()) === 1);
}

/** ids of everyone a text mentions: tokens first, then unambiguous plain names (longest first, so
 *  "@Ada Osei" isn't also read as a mention of someone called "Ada") */
export function mentionedIds(text: string, users: Array<{ id: string; name: string }>): string[] {
  const known = new Set(users.map(u => u.id));
  const hit = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) if (known.has(m[2]!)) hit.add(m[2]!);
  let rest = text.replace(MENTION_RE, ' ');
  for (const u of uniquelyNamed(users).sort((a, b) => b.name.length - a.name.length)) {
    const re = new RegExp(`(^|[^\\w@])@${escapeRe(u.name)}(?![\\w])`, 'gi');
    if (re.test(rest)) {
      hit.add(u.id);
      rest = rest.replace(re, '$1');
    }
  }
  return [...hit];
}
