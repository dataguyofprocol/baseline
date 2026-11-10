import { Illustration, type IllustrationName } from './illustrations.js';

/** Which situation the empty state is in. The module writes the words; the kind places the
 *  register dot, so two modules in the same situation look alike (DESIGN.md, empty states):
 *  - first:    nothing here yet. Indigo dot at the start of the line.
 *  - off:      the feature is turned off. Hollow dot: nothing runs.
 *  - filtered: the work exists, filters hide it. Dashed line, grey dot.
 *  - done:     caught up. The dot runs to the end and the line fills.
 *  - holding:  a place things are kept (archive, trash, drafts). Grey dot at rest.
 *  - missing:  nothing at this address, or it couldn't load. The line is broken. */
export type EmptyKind = 'first' | 'off' | 'filtered' | 'done' | 'holding' | 'missing';

export function EmptyState(props: {
  kind: EmptyKind;
  /** the faded word over the line: the module or the state, one or two words. Page size only. */
  word?: string;
  /** the module's illustration, drawn small beside the title; or a node for one that carries extras */
  illo?: IllustrationName | React.ReactNode;
  title: React.ReactNode;
  desc?: React.ReactNode;
  actions?: React.ReactNode;
  /** drawn on the dot (Inbox zero's burst) */
  dot?: React.ReactNode;
  /** pane: inside a section or side panel, no word (narrow containers drop it on their own too) */
  size?: 'page' | 'pane';
  className?: string;
}) {
  const { kind, size = 'page' } = props;
  const illo = typeof props.illo === 'string' ? <Illustration name={props.illo as IllustrationName} small /> : props.illo;
  return (
    <div className={`empty-state es es-${kind} es-${size}${props.className ? ' ' + props.className : ''}`}>
      {props.word && size === 'page' && <div className="es-word" aria-hidden="true">{props.word}</div>}
      <div className="es-line" aria-hidden="true">
        <span className="es-fill" />
        <span className="es-dot">{props.dot}</span>
      </div>
      <div className="es-body">
        {illo && <div className="es-illo">{illo}</div>}
        <div className="es-text">
          <div className="empty-title">{props.title}</div>
          {props.desc && <div className="empty-desc">{props.desc}</div>}
          {props.actions && <div className="empty-actions">{props.actions}</div>}
        </div>
      </div>
    </div>
  );
}
