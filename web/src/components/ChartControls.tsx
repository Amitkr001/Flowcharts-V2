import type { ChartEngine, ViewState } from '../chart/engine';
import type { ChartStyle, FpMode } from '../lib/types';

const D = {
  minus: 'M5 12h14', plus: 'M12 5v14M5 12h14', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6',
  reset: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4', fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  live: 'M6 6l6 6-6 6M13 6l6 6-6 6', play: 'M8 5l11 7-11 7z',
};
const Svg = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

interface Props {
  eng: ChartEngine | null; vs: ViewState; style: ChartStyle;
  fpMode: FpMode; onFpMode(m: FpMode): void;
  replaying: boolean; onReplay(): void;
}

/** Floating navigation bar + "scroll to real-time" + auto-scale toggle (Centered). */
export function ChartControls({ eng, vs, style, fpMode, onFpMode, replaying, onReplay }: Props) {
  if (!eng) return null;
  const B = (p: { t: string; d?: string; f(): void; on?: boolean; text?: string }) => (
    <button className={p.on ? 'on' : ''} title={p.t} aria-label={p.t} onClick={() => { p.f(); eng.cv.focus(); }}>
      {p.text ? <span style={{ fontWeight: 700, fontSize: 11, fontFamily: 'var(--mono)' }}>{p.text}</span> : <Svg d={p.d || ''} />}
    </button>
  );
  return (
    <div className="cc-bar" role="toolbar" aria-label="Chart navigation">
      <B t="Zoom In (+)" d={D.plus} f={() => eng.zoomIn()} />
      <B t="Zoom Out (−)" d={D.minus} f={() => eng.zoomOut()} />
      <B t="Reset View (Home)" d={D.reset} f={() => eng.reset()} />
      <B t="Fit all bars" d={D.fit} f={() => eng.fit()} />
      <span className="cc-sep" />
      <B t="Scroll left (←)" d={D.left} f={() => eng.scrollBars(10)} />
      <B t="Scroll right (→)" d={D.right} f={() => eng.scrollBars(-10)} />
      {!vs.live && <B t="Scroll to real-time (End)" d={D.live} f={() => eng.goLive()} on />}
      <span className="cc-sep" />
      <B t={vs.auto ? 'Auto-scale price is ON (double click axis)' : 'Auto-scale price is OFF'} text="A" f={() => eng.setAutoScale(!vs.auto)} on={vs.auto} />
      <B t="Bar replay" d={D.play} f={onReplay} on={replaying} />
      {style === 'footprint' && (
        <>
          <span className="cc-sep" />
          <div className="cc-seg" role="group" aria-label="Footprint mode">
            {([['ba', 'Bid×Ask'], ['delta', 'Delta'], ['vol', 'Volume']] as [FpMode, string][]).map(([m, l]) =>
              <button key={m} className={fpMode === m ? 'on' : ''} onClick={() => onFpMode(m)}>{l}</button>)}
          </div>
        </>
      )}
    </div>
  );
}
