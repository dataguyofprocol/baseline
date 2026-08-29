import { useMemo } from 'react';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    if (!text?.trim()) return null;
    const raw = marked.parse(text) as string;
    return raw.replace(/<a /g, '<a target="_blank" rel="noreferrer" ');
  }, [text]);
  if (!html) return null;
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
