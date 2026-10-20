'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const PLAN_DAYS = Number(process.env.PLAN_DAYS || 365);
const PRICE_LABEL = '$20 USD / annual subscription · ₹1,920 INR';
const PUBLIC_DIR = __dirname;
const DOAS_FILE = path.join(PUBLIC_DIR, 'doas.json');

function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(obj));
}
function bearer(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}
function readToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(parts[0]).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], 'base64url'); } catch (_) { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return payload && typeof payload.exp === 'number' && payload.exp >= Date.now() ? payload : null;
  } catch (_) { return null; }
}
function makeToken(last4) {
  const payload = Buffer.from(JSON.stringify({
    exp: Date.now() + PLAN_DAYS * 86400000,
    method: 'manual-last-four',
    ref: last4
  }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (_) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    return send(res, 200, { checkoutReady: false, checkoutUrl: '', priceLabel: PRICE_LABEL });
  }
  if (req.method === 'POST' && url.pathname === '/api/access') {
    try {
      const body = await readJson(req);
      const last4 = String(body.last4 || '').replace(/\s/g, '');
      if (!/^\d{4}$/.test(last4)) {
        return send(res, 400, { error: 'Enter exactly the last 4 digits of your transaction ID.' });
      }
      return send(res, 200, { token: makeToken(last4), exp: Date.now() + PLAN_DAYS * 86400000 });
    } catch (_) {
      return send(res, 400, { error: 'Please enter the last 4 digits of your transaction ID.' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/doas') {
    const payload = readToken(bearer(req));
    if (!payload) return send(res, 401, { error: 'Subscription required.' });
    try {
      const doas = JSON.parse(fs.readFileSync(DOAS_FILE, 'utf8'));
      return send(res, 200, { doas, exp: payload.exp, planDays: PLAN_DAYS });
    } catch (error) {
      console.error('Doa data error:', error.message);
      return send(res, 500, { error: 'Could not load doas.' });
    }
  }
  return send(res, 404, { error: 'Not found.' });
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
const PRIVATE_FILES = new Set(['/server.js', '/package.json', '/doas.json', '/claims.json', '/unlock-codes.json', '/.env']);
function serveStatic(req, res, url) {
  let relative = decodeURIComponent(url.pathname);
  if (PRIVATE_FILES.has(relative)) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end('Not found'); }
  if (relative === '/') relative = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (error, body) => {
    if (error) {
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackError, index) => {
        if (fallbackError) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        res.end(index);
      });
    }
    const ext = path.extname(file).toLowerCase();
    const noCache = ext === '.html' || path.basename(file) === 'sw.js' || ext === '.webmanifest';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    res.end(body);
  });
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong.' });
  }
});
server.listen(PORT, () => console.log('My Doas App listening on port ' + PORT));
