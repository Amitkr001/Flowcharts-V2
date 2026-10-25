# FlowScope

Real-time order-flow charting: footprint, liquidity heatmap, big trades, DOM, stacked imbalances,
absorption / exhaustion signals, liquidations, open interest, session profiles, alerts, paper trading,
trade journal, custom script indicators and tick backtesting.

## Requirements
Node.js 22.6 or newer (24 recommended). No database required (MongoDB optional).

## Run locally
    npm install
    npm run build
    npm start                 # http://localhost:8080

Development (hot reload): `npm run dev:server` and `npm run dev:web` (http://localhost:5173).

## Deploy on a Linux server (Oracle Cloud, any VPS)
    npm install && npm run build
    sudo npm install -g pm2
    pm2 start ecosystem.config.cjs && pm2 save && pm2 startup

Public HTTPS link without opening firewall ports (Cloudflare Tunnel):
    cloudflared tunnel --url http://localhost:8080

## Deploy with Docker
    cp .env.example .env
    docker compose up -d --build

## Settings
Server settings are environment variables — see `.env.example`. With PM2 they live in `ecosystem.config.cjs`.
Markets in `RECORD` are recorded from boot; others start when first opened. DEMO is a built-in simulator
that works without internet access.

## Keyboard
Ctrl/⌘K command palette · / markets · ? shortcuts · F focus mode · B bottom tray · Alt+1–6 tools ·
1–6 timeframes · Home reset view · End real-time

## Project layout
    server/src        data gateway, REST API, WebSocket, exchange feeds, auth, storage
    web/src           React app (chart engine, pages, components, styles)
    Dockerfile, docker-compose.yml, ecosystem.config.cjs, .env.example
