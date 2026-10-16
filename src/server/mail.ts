// Outgoing email over SMTP. Off unless SMTP_HOST is set; callers then fall back to links people copy.
// (Retries, digests and an outbox come with notification email; invites send once and report back.)
import nodemailer from 'nodemailer';

export interface MailMessage { to: string; subject: string; text: string; html: string }
export interface Mailer {
  /** false: no SMTP configured — nothing is sent */
  configured: boolean;
  send(msg: MailMessage): Promise<void>;
}

/** SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_FROM ("Baseline <baseline@acme.dev>"),
 *  SMTP_SECURE (implicit TLS; on by default for port 465, otherwise STARTTLS is negotiated) */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const host = env.SMTP_HOST?.trim();
  if (!host) return { configured: false, send: async () => { throw new Error('Email isn\'t set up on this server (SMTP_HOST)'); } };
  const port = Number(env.SMTP_PORT ?? 587);
  const from = env.SMTP_FROM?.trim();
  if (!from) throw new Error('SMTP_HOST is set, so SMTP_FROM is required too');
  const transport = nodemailer.createTransport({
    host, port, secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
  });
  return { configured: true, send: async (msg) => { await transport.sendMail({ from, ...msg }); } };
}

const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** plain text plus a small HTML version with one button — names are escaped, they're user-chosen */
function render(paragraphs: string[], action?: { label: string; url: string }): { text: string; html: string } {
  const text = [...paragraphs, ...(action ? [`${action.label}: ${action.url}`] : [])].join('\n\n');
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2023;max-width:520px">`
    + paragraphs.map(p => `<p style="margin:0 0 14px">${esc(p)}</p>`).join('')
    + (action ? `<p style="margin:20px 0"><a href="${esc(action.url)}" style="background:#5e6ad2;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;display:inline-block">${esc(action.label)}</a></p>` : '')
    + `</div>`;
  return { text, html };
}

export function inviteEmail(o: { to: string; inviter: string; workspace: string; link: string; expiresAt: string }): MailMessage {
  const expires = new Date(o.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  return {
    to: o.to,
    subject: `${o.inviter} invited you to ${o.workspace} on Baseline`,
    ...render([
      `${o.inviter} invited you to join ${o.workspace} on Baseline, where the team tracks its issues and projects.`,
      `Sign in with the Google account for ${o.to}. The invite expires on ${expires}.`,
    ], { label: `Join ${o.workspace}`, url: o.link }),
  };
}

export function inviteAcceptedEmail(o: { to: string; who: string; workspace: string; link: string }): MailMessage {
  return {
    to: o.to,
    subject: `${o.who} accepted your invite to ${o.workspace}`,
    ...render([`${o.who} accepted your invite and joined ${o.workspace}.`], { label: 'Open Baseline', url: o.link }),
  };
}
