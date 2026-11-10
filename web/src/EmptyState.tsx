import { Illustration, type IllustrationName } from './illustrations.js';

export type EmptyKind = 'first' | 'off' | 'filtered' | 'done' | 'holding' | 'missing';

export function EmptyState(props: {
  kind: EmptyKind;
  word?: string;
  illo?: IllustrationName | React.ReactNode;
  title: React.ReactNode;
  desc?: React.ReactNode;
  actions?: React.ReactNode;
  dot?: React.ReactNode;
  size?: 'page' | 'pane';
  className?: string;
}) {
  const { kind, size = 'page' } = props;
  const illo = typeof props.illo === 'string' ? <Illustration name={props.illo as IllustrationName} small /> : props.illo;
  const wordIsTitle = size === 'page' && typeof props.title === 'string' && props.word?.trim().toLowerCase() === props.title.trim().toLowerCase();
  return (
    <div className={`empty-state es es-${kind} es-${size}${wordIsTitle ? ' es-word-is-title' : ''}${props.className ? ' ' + props.className : ''}`}>
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
