// The desktop around a terminal command: the clipboard and the browser. Shared by the CLI and the TUI.
import { spawn, spawnSync } from 'node:child_process';

/** copy text to the system clipboard via whatever helper exists; false if none worked */
export function copyToClipboard(text: string): boolean {
  for (const [cmd, args] of [['pbcopy', [] as string[]], ['wl-copy', []], ['xclip', ['-selection', 'clipboard']]] as const) {
    const r = spawnSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    if (!r.error && r.status === 0) return true;
  }
  return false;
}

/** the OSC 52 escape that asks the terminal itself to set the clipboard; it travels over SSH and needs no helper */
export const osc52 = (text: string) => `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`;

export function openBrowser(url: string): void {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
