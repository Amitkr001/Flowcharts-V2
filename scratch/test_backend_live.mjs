import http from 'node:http';

const BASE = 'http://localhost:8080';
const WS_URL = 'ws://localhost:8080/ws';

async function testHttp() {
  console.log('--- Testing HTTP REST Endpoints ---');
  const results = {};

  // 1. Health
  try {
    const r = await fetch(`${BASE}/api/health`);
    results.health = { status: r.status, data: await r.json() };
    console.log('✓ /api/health:', results.health.status, results.health.data);
  } catch (e) {
    results.health = { error: e.message };
    console.error('✗ /api/health error:', e.message);
  }

  // 2. Symbols
  try {
    const r = await fetch(`${BASE}/api/symbols`);
    const syms = await r.json();
    results.symbols = {
      status: r.status,
      count: syms.length,
      sample: syms.slice(0, 3).map(s => ({ id: s.id, bigUsd: s.bigUsd, bigQty: s.bigQty, unit: s.contractUnit }))
    };
    console.log('✓ /api/symbols: count =', syms.length, 'sample:', results.symbols.sample);
  } catch (e) {
    results.symbols = { error: e.message };
    console.error('✗ /api/symbols error:', e.message);
  }

  // 3. Calendar
  try {
    const r = await fetch(`${BASE}/api/calendar`);
    const cal = await r.json();
    results.calendar = { status: r.status, count: Array.isArray(cal) ? cal.length : 0 };
    console.log('✓ /api/calendar: status =', r.status, 'events count =', results.calendar.count);
  } catch (e) {
    results.calendar = { error: e.message };
    console.error('✗ /api/calendar error:', e.message);
  }

  // 4. Klines
  try {
    const r = await fetch(`${BASE}/api/klines?sym=BTCUSD&tf=60&limit=5`);
    const k = await r.json();
    results.klines = { status: r.status, count: Array.isArray(k) ? k.length : 0 };
    console.log('✓ /api/klines: status =', r.status, 'bars count =', results.klines.count);
  } catch (e) {
    results.klines = { error: e.message };
    console.error('✗ /api/klines error:', e.message);
  }

  // 5. Auth flow: register & login & me
  try {
    const testEmail = `tester_${Date.now()}@flowcharts.internal`;
    const regRes = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'SecurePassword123!', name: 'Audit Bot' })
    });
    const regData = await regRes.json();
    console.log('✓ /api/auth/register:', regRes.status, 'token present:', Boolean(regData.token));

    const logRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'SecurePassword123!' })
    });
    const logData = await logRes.json();
    console.log('✓ /api/auth/login:', logRes.status, 'user:', logData.user?.email);

    const meRes = await fetch(`${BASE}/api/me`, {
      headers: { 'Authorization': `Bearer ${logData.token}` }
    });
    const meData = await meRes.json();
    console.log('✓ /api/me with JWT:', meRes.status, 'verified user:', meData.email);

    // Docs store test with auth
    const putDocRes = await fetch(`${BASE}/api/docs/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${logData.token}`
      },
      body: JSON.stringify({ data: { auditTest: true, timestamp: Date.now() } })
    });
    console.log('✓ PUT /api/docs/settings:', putDocRes.status);

    const getDocRes = await fetch(`${BASE}/api/docs/settings`, {
      headers: { 'Authorization': `Bearer ${logData.token}` }
    });
    const docData = await getDocRes.json();
    console.log('✓ GET /api/docs/settings:', getDocRes.status, 'auditTest =', docData.data?.auditTest);
  } catch (e) {
    console.error('✗ Auth flow error:', e.message);
  }
}

function testWebSocket() {
  return new Promise((resolve) => {
    console.log('\n--- Testing WebSocket /ws Protocol ---');
    try {
      const ws = new WebSocket(WS_URL);
      let receivedSnapshot = false;
      let receivedTicks = false;
      let receivedBook = false;

      ws.addEventListener('open', () => {
        console.log('✓ WebSocket connected to', WS_URL);
        ws.send(JSON.stringify({ op: 'sub', sym: 'BTCUSD' }));
      });

      ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data.toString());
          if (msg.t === 'snap') {
            receivedSnapshot = true;
            console.log('✓ WS snapshot received for', msg.sym, 'ticks =', msg.ticks?.length, 'bids =', msg.bids?.length);
          } else if (msg.t === 'tk') {
            receivedTicks = true;
            console.log('✓ WS live trade tick batch received for', msg.sym, 'count =', msg.d?.length);
          } else if (msg.t === 'bk') {
            receivedBook = true;
            console.log('✓ WS book depth received for', msg.sym, 'bids =', msg.b?.length, 'asks =', msg.a?.length);
          }

          if (receivedSnapshot && (receivedTicks || receivedBook)) {
            ws.close();
          }
        } catch (e) {
          console.error('WS parse error:', e.message);
        }
      });

      ws.addEventListener('close', () => {
        console.log('✓ WebSocket closed cleanly.');
        resolve({ receivedSnapshot, receivedTicks, receivedBook });
      });

      ws.addEventListener('error', (err) => {
        console.error('✗ WebSocket error:', err);
        resolve({ error: err });
      });

      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
        resolve({ receivedSnapshot, receivedTicks, receivedBook, timedOut: true });
      }, 6000);
    } catch (e) {
      console.error('WS init error:', e.message);
      resolve({ error: e.message });
    }
  });
}

async function run() {
  await testHttp();
  await testWebSocket();
  console.log('\nAll direct live tests finished.');
}

run();
