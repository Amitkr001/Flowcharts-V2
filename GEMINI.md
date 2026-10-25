# FlowScope — Project Memory & Context
**Owner:** Amit Kumar  
**Project:** FlowScope (Real-time order-flow charting web application)  
**Workspace:** `c:\Users\amitk\Downloads\Flowcharts` / Remote: `~/Flowcharts` on Oracle Cloud  

---

## 1. Project Overview & Architecture

FlowScope is a high-performance, real-time order-flow charting and trading analysis web application.

- **Monorepo Structure (npm workspaces):**
  - `server`: Node.js >= 22.6 (runs TypeScript directly via `--experimental-strip-types`, no build step needed)
  - `web`: React 19 + Vite 7 (vanilla canvas renderer, zero bloated UI libraries, custom "Terminal" design system)
- **Data Architecture:**
  - `server/src/market.ts` (`MarketHub`): Aggregates real-time feeds across exchanges into a unified tape, handles tick history, order book depth, heatmap sampling, liquidation feeds, and open interest.
  - Feeds supported: Binance Futures & Spot, Bybit, OKX, Hyperliquid (including HIP-3 `xyz:`), plus an offline DEMO simulator (`feeds/sim.ts`).
  - WebSocket Server: Built dependency-free (RFC 6455 compliant) at `wsserver.ts`, serving on `/ws`.
  - Persistence: Lightweight JSON file-based document store or optional MongoDB (`store/mongo.ts`, `store/ticks.ts`).

---

## 2. Codebase Organization

### Server (`server/src/`)
- `index.ts`: HTTP server, static file server for production build, REST endpoints, WebSocket `/ws` mount.
- `market.ts`: Real-time market hub, book depth, heatmap sampling, trade tapes, liquidations, OI broadcast.
- `symbols.ts`: Asset catalog (crypto perps/spot, metals, indices, commodities, forex/CFD, DEMO).
- `types.ts`: Server-side data contracts and domain types.
- `feeds/exchanges.ts`: Exchange integrations (Binance, Bybit, OKX, Hyperliquid).
- `feeds/derivs.ts`: Liquidations, funding rates, open interest collectors.
- `feeds/socket.ts`: Resilient auto-reconnecting WebSocket client wrapper.
- `feeds/sim.ts`: Deterministic synthetic order flow for offline demo mode.
- `history.ts`: Exchange kline history fetching.
- `wsserver.ts`: Pure Node.js RFC 6455 WebSocket implementation.
- `auth.ts`: scrypt password hashing + HS256 JWT auth.
- `store/docs.ts`: User documents and preferences (JSON / Mongo).

### Web Client (`web/src/`)
- **Chart Core:**
  - `chart/engine.ts`: HTML5 Canvas rendering engine (candles, footprint Bid×Ask / Delta / Volume, DOM depth strip, liquidity heatmap with dynamic contrast/cutoff, DeepCharts split volume profile with Left Delta + Right Normal Volume, session profiles POC/VAH/VAL, imbalance zones).
  - `chart/drawings.ts`: 41 interactive drawing tools with hover badges and order-flow info cards.
  - `chart/signals.ts`: Absorption, exhaustion, unfinished auction, and delta divergence detection.
  - `chart/levels.ts`: Key session levels (PDH, PDL, PDC, session open, naked POCs).
- **Data Layer:**
  - `data/client.ts`: WebSocket client communicating with server `/ws`.
  - `data/bars.ts`: Real-time footprint aggregator, trade clustering, and bar construction with custom big trade size filtering.
  - `data/bookwatch.ts`: Iceberg order detection, book pulls, and large fill tracking.
- **Pages & Components:**
  - `pages/ChartPage.tsx`: Primary trading interface with continuous drawing mode.
  - `pages/MultiChartPage.tsx`: Multi-pane chart layouts (1, 2, 4 linked views).
  - `pages/IndicatorsPage.tsx`: Custom JS script indicator editor with sandbox runtime.
  - `pages/BacktestPage.tsx`: Tick-level strategy backtester.
  - `pages/JournalPage.tsx`: Trade journal with automated screenshot capture.
  - `pages/AccountPage.tsx`: Accounts, cloud sync, and backup export/import.
  - `components/FlowSettings.tsx`: Tabbed settings modal for big trade thresholds, heatmap contrast/cutoff, volume profile modes, imbalances, and book walls.
  - UI Chrome: `MenuBar`, `InstrumentBar`, `ChartToolbar` (with indicator ⚙️ gear buttons), `StatusLine`, `CommandPalette` (Ctrl+K), `OrderTicket`, `Panels` (WidgetBar, RightPanel, BottomTray).

---

## 3. UI Design System ("Terminal" v4)

Strict styling and design conventions implemented across `web/src/styles/`:
- **Color Semantics:**
  - **Green / Up / Bid:** Reserved strictly for bullish market action and bid volume.
  - **Violet / Down / Ask:** Reserved strictly for bearish market action and ask volume.
  - **Never use green/red/violet for generic UI button states or status toggles.**
  - **Blue Accent:** Used exclusively for UI active/selected states, focus rings, and primary interactive controls.
- **Visuals:** Near-black tonal surfaces, 1px hairline borders, elevation shadows only on floating overlays/modals.
- **Typography:** `Inter` for interface copy, `JetBrains Mono` with tabular numbers (`tnum`) for all prices, deltas, and volumes.
- **Layout Grid:** 4px grid rhythm, 6px / 8px / 12px border radii.
- **Mobile Viewports (< 768px & < 480px):**
  - Right panel acts as an overlay slide-out drawer so chart canvas never collapses to 0px.
  - Horizontal swipe navigation on `InstrumentBar` stats and `ChartToolbar`.
  - Icon-only compact header navigation.
- **Key Navigation:**
  - `Ctrl/Cmd + K`: Command palette / quick actions
  - `/`: Quick market symbol search
  - `?`: Keyboard shortcuts overlay
  - `F`: Focus mode (hides chrome)
  - `B`: Toggle bottom tray (orders / positions / journal)
  - `Alt + 1-6`: Quick panel toggles; `Alt + 0`: Close side panels
  - `1-6`: Timeframe switching
  - `Home`: Reset zoom & pan; `End`: Jump to real-time head

---

## 4. Deployment & Infrastructure

- **Target Host:** Oracle Cloud Always Free (A1 Flex ARM, Oracle Linux 9)
  - **Region:** `ap-mumbai-1`
  - **Public IP:** `92.4.87.5`
  - **SSH Connection:** `ssh -i ssh-key-2026-10-19.key opc@92.4.87.5` (User MUST be `opc`)
- **Remote Directory:** `~/Flowcharts`
- **Process Manager:** PM2 (service name: `flowscope`, internal port `8080`)
- **Web Tunneling:** Cloudflare Tunnel (`cloudflared`) pointing to `http://localhost:8080`
- **Target Domain:** `flowscope.webcraftlabs.in` via named Cloudflare tunnel.
- **Crucial Rule:** Never host feeds on US-based IP addresses (Binance and Bybit block US IPs).

---

## 5. Lessons Learned & Avoided Pitfalls

1. **Chat Code Generation Stripping Object Keys:**
   - Previous bug: `[sym]:` and `[k]:` computed property keys were stripped or corrupted by markdown formatters.
   - Rule: Always avoid ambiguous computed object properties in pasted code or verify syntax carefully.
2. **Oracle Linux SSH Username:**
   - Default user on Oracle Linux is `opc` (not `root`, not email, not `ubuntu`).
3. **Oracle VCN Subnet CIDR Conflicts:**
   - When creating instances, do not create duplicate subnets if `10.0.0.0/24` exists; attach to existing VCN/subnet.
4. **Drawing Submenu Hit Areas & Continuous Drawing:**
   - Tiny 5px CSS triangle triggers caused mis-clicks on mobile and desktop; replaced with 13x13px chevron buttons and touch long-press detection.
   - Added `keepTool` toggle to prevent involuntary reset to `'cursor'` after drawing one shape.
5. **Volume Profile DeepCharts Layout:**
   - DeepCharts renders dual profiles: net Delta profile on left edge (green for positive, violet for negative + ΔPOC) and normal Volume profile on right edge (total volume, buy/sell split, Value Area, Volume POC).
6. **Server Startup Timing:**
   - Feeds and WebSocket listener take ~5–8 seconds to initialize; avoid checking health immediately after restart.
7. **No Extra UI Dependencies:**
   - Do NOT add heavy third-party UI libraries (MUI, AntD, etc.) to `web`. Follow the shadcn / bespoke component philosophy in `web/src/components`.

---

## 6. Current Operational Checklist

- [ ] Ensure PM2 tunnel job runs reliably (`pm2 start cloudflared --name tunnel -- tunnel --url http://localhost:8080`).
- [ ] Configure permanent Cloudflare named tunnel for `flowscope.webcraftlabs.in`.
- [ ] Ensure `pm2 startup` and `pm2 save` are configured on the Oracle VM.
- [ ] Monitor memory usage on Oracle VM (upgrade shape if running > 15 active high-frequency market feeds).
- [ ] Add MongoDB integration if long-term multi-day tick persistence is required.
