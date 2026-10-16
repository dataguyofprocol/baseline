// Minimal typings for the Markdown converters the editor uses (they ship none).
declare module 'turndown' {
  interface Rule {
    filter: string | string[] | ((node: HTMLElement) => boolean);
    replacement: (content: string, node: HTMLElement) => string;
  }
  export default class TurndownService {
    constructor(options?: Record<string, unknown>);
    use(plugin: unknown): this;
    addRule(key: string, rule: Rule): this;
    turndown(html: string): string;
  }
}
declare module 'turndown-plugin-gfm' {
  export const gfm: unknown;
}
