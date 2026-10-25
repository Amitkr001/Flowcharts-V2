/**
 * Drawing rail (left of the chart). One button per tool group; the button remembers the last tool used
 * in its group (TradingView pattern).
 * Double-click, clicking an active tool, or right-clicking opens the full options submenu.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../lib/icons';
import { TOOLS, TOOL_GROUPS } from '../chart/drawings';
import { loadRaw, saveRaw } from '../lib/store';

interface Props {
  tool: string; onTool(t: string): void;
  magnet: boolean; onMagnet(): void;
  locked: boolean; onLock(): void;
  hidden: boolean; onHide(): void;
  keepTool?: boolean; onKeepTool?(): void;
  onUndo(): void; onRedo(): void; onClear(): void; onShot(): void;
}

const byGroup = TOOL_GROUPS.map(g => [g, TOOLS.filter(t => t.group === g)] as const).filter(([, t]) => t.length);
const groupToolsMap: Record<string, typeof TOOLS> = Object.fromEntries(byGroup);

export function LeftToolbar(p: Props) {
  const [open, setOpen] = useState<{ group: string; top: number; left: number } | null>(null);
  const [last, setLast] = useState<Record<string, string>>(() => loadRaw('fs.lastTool', {}));
  const box = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const touchTimer = useRef<any>(null);

  useEffect(() => { saveRaw('fs.lastTool', last); }, [last]);

  useEffect(() => {
    if (!open) return;
    const c = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        box.current && !box.current.contains(target) &&
        flyoutRef.current && !flyoutRef.current.contains(target)
      ) {
        setOpen(null);
      }
    };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('mousedown', c);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('mousedown', c);
      window.removeEventListener('keydown', k);
    };
  }, [open]);

  const pick = (g: string, id: string) => {
    setLast(l => { const next = { ...l }; next[g] = id; return next; });
    p.onTool(id);
    setOpen(null);
  };

  const toggleGroup = (g: string, el: HTMLElement) => {
    if (open?.group === g) {
      setOpen(null);
    } else {
      const r = el.getBoundingClientRect();
      const top = Math.max(8, Math.min(window.innerHeight - 340, r.top));
      const left = Math.round(r.right + 6);
      setOpen({ group: g, top, left });
    }
  };

  const handleTouchStart = (g: string, el: HTMLElement) => {
    touchTimer.current = setTimeout(() => {
      toggleGroup(g, el);
    }, 400);
  };

  const handleTouchEnd = () => {
    if (touchTimer.current) clearTimeout(touchTimer.current);
  };

  const Btn = ({ ic, tip, on, f }: { ic: string; tip: string; on?: boolean; f(): void }) =>
    <button className={`tb ${on ? 'on' : ''}`} data-tip={tip} aria-label={tip} aria-pressed={on} onClick={f}><Icon n={ic} /></button>;

  return (
    <nav className="vbar" ref={box} aria-label="Drawing tools">
      <Btn ic="cursor" tip="Cursor  Esc" on={p.tool === 'cursor'} f={() => p.onTool('cursor')} />
      <span className="tsep" />
      {byGroup.map(([g, tools]) => {
        const cur = tools.find(t => t.id === last[g]) || tools[0];
        const active = tools.some(t => t.id === p.tool);
        const shown = active ? (tools.find(t => t.id === p.tool) || cur) : cur;
        const isOpen = open?.group === g;

        return (
          <div
            key={g}
            className={`grp ${isOpen ? 'active-flyout' : ''}`}
            onContextMenu={e => {
              e.preventDefault();
              toggleGroup(g, e.currentTarget);
            }}
          >
            <button
              className={`tb ${active ? 'on' : ''}`}
              data-tip={`${shown.label}${shown.key ? '  ' + shown.key : ''}`}
              aria-label={shown.label}
              onClick={(e) => {
                if (active) {
                  if (tools.length === 1) {
                    p.onTool('cursor');
                  } else {
                    toggleGroup(g, e.currentTarget);
                  }
                } else {
                  pick(g, shown.id);
                }
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleGroup(g, e.currentTarget);
              }}
              onTouchStart={(e) => handleTouchStart(g, e.currentTarget)}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              <Icon n={shown.icon} />
            </button>
          </div>
        );
      })}

      {/* Fixed-positioned flyout to guarantee it will never be clipped by parent overflow */}
      {open && groupToolsMap[open.group] && (
        <div
          ref={flyoutRef}
          className="flyout"
          role="menu"
          style={{
            position: 'fixed',
            top: open.top,
            left: open.left,
            zIndex: 9999,
          }}
        >
          <h6>{open.group}</h6>
          {groupToolsMap[open.group].map(t => (
            <div
              key={t.id}
              role="menuitem"
              className={`it ${p.tool === t.id ? 'on' : ''}`}
              onClick={() => pick(open.group, t.id)}
            >
              <Icon n={t.icon} size={16} />
              <span>{t.label}</span>
              {t.key && <kbd>{t.key}</kbd>}
            </div>
          ))}
        </div>
      )}

      <span className="tsep" />
      {p.onKeepTool && (
        <Btn
          ic="pencil"
          tip={p.keepTool ? "Stay in drawing mode: ON" : "Stay in drawing mode: OFF"}
          on={p.keepTool}
          f={p.onKeepTool}
        />
      )}
      <Btn ic="magnet" tip="Magnet — snap to OHLC (hold Ctrl to bypass)" on={p.magnet} f={p.onMagnet} />
      <Btn ic={p.locked ? 'lock' : 'unlock'} tip={p.locked ? 'Unlock all drawings' : 'Lock all drawings'} on={p.locked} f={p.onLock} />
      <Btn ic={p.hidden ? 'eyeoff' : 'eye'} tip={p.hidden ? 'Show drawings' : 'Hide drawings'} on={p.hidden} f={p.onHide} />
      <span className="tsep" />
      <Btn ic="undo" tip="Undo  Ctrl+Z" f={p.onUndo} />
      <Btn ic="redo" tip="Redo  Ctrl+Y" f={p.onRedo} />
      <Btn ic="trash" tip="Remove all drawings" f={p.onClear} />
    </nav>
  );
}
