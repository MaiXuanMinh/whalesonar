// WhaleSonar — server tĩnh cho bản Desktop (Node 18+, không cần cài thư viện).
// Toàn bộ phân tích chạy trong trình duyệt (public/core.js); server chỉ phục vụ file.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3939;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

let lastPing = Date.now();

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/api/ping') {
    lastPing = Date.now();
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"ok":true}');
  }
  const file = path.normalize(path.join(PUBLIC_DIR, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname)));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});

// Khi mở bằng icon desktop (WS_AUTO_EXIT=1): tự tắt server khi cửa sổ app đóng (không còn ping)
if (process.env.WS_AUTO_EXIT === '1') {
  setInterval(() => {
    if (Date.now() - lastPing > 3 * 60_000) process.exit(0);
  }, 30_000).unref();
}

server.on('error', (e) => {
  // Đã có một server khác chạy ở cổng này → không cần chạy thêm
  if (e.code === 'EADDRINUSE') { console.log(`Cổng ${PORT} đang được dùng — WhaleSonar có thể đã chạy sẵn.`); process.exit(0); }
  throw e;
});
server.listen(PORT, () => console.log(`WhaleSonar đang chạy tại http://localhost:${PORT}`));
