import { pwa, triggerInstall, closeInstallModal } from '../lib/pwa';
import { I } from './ui/Icons';

export function InstallModal() {
  const show = pwa.use(s => s.showModal);
  const promptEvent = pwa.use(s => s.promptEvent);
  const isStandalone = pwa.use(s => s.isStandalone);

  if (!show || isStandalone) return null;

  return (
    <div className="modal-backdrop" onClick={closeInstallModal} role="dialog" aria-modal="true" aria-labelledby="pwa-title">
      <div className="modal pwa-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="pwa-head-left">
            <img src="/icon-192.png" width="32" height="32" alt="FlowCharts" className="pwa-icon" />
            <div>
              <h4 id="pwa-title">Install FlowCharts Desktop App</h4>
              <small>Run FlowCharts as a native standalone desktop application</small>
            </div>
          </div>
          <button className="icon-btn" onClick={closeInstallModal} aria-label="Close dialog">
            <I n="close" s={16} />
          </button>
        </div>

        <div className="pwa-body">
          <div className="pwa-features">
            <div className="pwa-feat">
              <span className="pwa-feat-icon">🖥️</span>
              <div>
                <b>Desktop Shortcut</b>
                <p>Creates a desktop icon and pins to your Windows Taskbar &amp; Start Menu.</p>
              </div>
            </div>
            <div className="pwa-feat">
              <span className="pwa-feat-icon">⚡</span>
              <div>
                <b>Zero Chrome Clutter</b>
                <p>Opens in its own dedicated, borderless high-performance window without URL bars.</p>
              </div>
            </div>
            <div className="pwa-feat">
              <span className="pwa-feat-icon">🚀</span>
              <div>
                <b>GPU Acceleration</b>
                <p>Full 60fps canvas hardware rendering with instant startup.</p>
              </div>
            </div>
          </div>

          {promptEvent ? (
            <div className="pwa-action-box">
              <button className="pwa-install-btn-big" onClick={triggerInstall}>
                <I n="download" s={16} />
                <span>Install to Desktop Now</span>
              </button>
            </div>
          ) : (
            <div className="pwa-guide">
              <h5>How to Install in 2 Clicks:</h5>
              <div className="pwa-step">
                <span className="pwa-step-num">1</span>
                <div>
                  Look at the <b>right side of your browser address bar</b> at the top.
                </div>
              </div>
              <div className="pwa-step">
                <span className="pwa-step-num">2</span>
                <div>
                  Click the <b>Install App icon (⊕ or 💻)</b>:
                  <div className="pwa-hint">
                    In <b>Chrome / Brave</b>: Click <code>⊕ Install FlowCharts</code> or <code>⋮ → Save and share → Install FlowCharts</code>
                    <br />
                    In <b>Microsoft Edge</b>: Click <code>⊞ App available</code> or <code>… → Apps → Install FlowCharts</code>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={closeInstallModal}>
            Close
          </button>
          {promptEvent && (
            <button className="btn primary" onClick={triggerInstall}>
              Install App
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
