// A single-line text field as data: the value and a cursor counted in characters, edited by key names.

export interface TextField { value: string; cursor: number }

export const emptyField: TextField = { value: '', cursor: 0 };
export const fieldOf = (value: string): TextField => ({ value, cursor: [...value].length });

/** the field after one key, or null when the key isn't an edit (so the caller can treat it as a command) */
export function editField(f: TextField, name: string, raw: string): TextField | null {
  const chars = [...f.value];
  const at = Math.min(f.cursor, chars.length);
  const set = (next: string[], cursor: number): TextField => ({ value: next.join(''), cursor });
  switch (name) {
    case 'backspace': return at ? set([...chars.slice(0, at - 1), ...chars.slice(at)], at - 1) : f;
    case 'delete': case 'ctrl+d': return set([...chars.slice(0, at), ...chars.slice(at + 1)], at);
    case 'left': case 'ctrl+b': return { ...f, cursor: Math.max(0, at - 1) };
    case 'right': case 'ctrl+f': return { ...f, cursor: Math.min(chars.length, at + 1) };
    case 'home': case 'ctrl+a': return { ...f, cursor: 0 };
    case 'end': case 'ctrl+e': return { ...f, cursor: chars.length };
    case 'ctrl+u': return set(chars.slice(at), 0);
    case 'ctrl+w': case 'meta+backspace': {
      let i = at;
      while (i > 0 && chars[i - 1] === ' ') i--;
      while (i > 0 && chars[i - 1] !== ' ') i--;
      return set([...chars.slice(0, i), ...chars.slice(at)], i);
    }
  }
  if (name.includes('+') && name !== '+' || !raw) return null;
  const text = raw.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '');
  if (!text) return null;
  const ins = [...text];
  return set([...chars.slice(0, at), ...ins, ...chars.slice(at)], at + ins.length);
}
