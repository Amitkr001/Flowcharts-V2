// PM2 process file (Oracle Cloud / any VPS without Docker):
//   npm install && npm run build
//   pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
module.exports = {
  apps: [{
    name: 'flowscope',
    cwd: __dirname,
    script: 'server/src/index.ts',
    interpreter: 'node',
    interpreter_args: '--experimental-strip-types',
    env: {
      NODE_ENV: 'production',
      PORT: 8080,
      DATA_DIR: __dirname + '/data',
      RECORD: 'BTCUSD,ETHUSD,XAUUSDT,XAGUSDT,GOLD,SILVER,SP500,NDX,DEMO',
      HISTORY_HOURS: 8,
    },
    max_memory_restart: '1500M',
    autorestart: true,
    restart_delay: 3000,
  }],
};
