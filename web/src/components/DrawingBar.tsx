/** Floating property bar for the selected drawing: colour, width, style, fill, text, lock, clone, delete. */
import type { Drawing } from '../lib/types';
import { PALETTE, TOOL_MAP } from '../chart/drawings';
import { Icon } from '../lib/icons';

interface Props { d: Drawing; onPatch(p: Partial<Drawing>): void; onClone(): void; onDelete(): void }

const FILLABLE = new Set(['rect', 'ellipse', 'triangle', 'channel', 'text']);

export function DrawingBar({ d, onPatch, onClone, onDelete }: Props) {
  const def = TOOL_MAP.get(d.type);
  const hasText = def?.text !== undefined;
  return (
    <div className="dbar" role="toolbar" aria-label="Drawing properties" onMouseDown={(e: { stopPropagation(): void }) => e.stopPropagation()}>
      <span className="db-name">{def?.label || d.type}</span>
      <span className="db-sep" />
      <div className="db-sw">
        {PALETTE.map(c => <button key={c} className={`sw-c ${d.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => onPatch({ color: c })} />)}
        <label className="sw-c custom" title="Custom colour"><input type="color" value={/^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#e6e6e6'} onChange={e => onPatch({ color: e.target.value })} /></label>
      </div>
      <span className="db-sep" />
      <select value={d.width} onChange={e => onPatch({ width: +e.target.value })} aria-label="Line width">
        {[1, 1.5, 2, 3, 4].map(w => <option key={w} value={w}>{w}px</option>)}
      </select>
      <select value={d.dash} onChange={e => onPatch({ dash: +e.target.value as 0 | 1 | 2 })} aria-label="Line style">
        <option value={0}>Solid</option><option value={1}>Dashed</option><option value={2}>Dotted</option>
      </select>
      {FILLABLE.has(d.type) && <button className={`tb ${d.fill ? 'on' : ''}`} title="Fill" aria-pressed={!!d.fill} onClick={() => onPatch({ fill: !d.fill })}><Icon n="rect" size={16} /></button>}
      {hasText && <input className="db-text" value={d.text || ''} placeholder="Label" onChange={e => onPatch({ text: e.target.value })} aria-label="Label text" />}
      <span className="db-sep" />
      <button className={`tb ${d.locked ? 'on' : ''}`} title={d.locked ? 'Unlock' : 'Lock'} aria-pressed={!!d.locked} onClick={() => onPatch({ locked: !d.locked })}><Icon n={d.locked ? 'lock' : 'unlock'} size={16} /></button>
      <button className="tb" title="Clone  Ctrl+D" onClick={onClone}><Icon n="copy" size={16} /></button>
      <button className="tb danger" title="Delete  Del" onClick={onDelete}><Icon n="trash" size={16} /></button>
    </div>
  );
}
