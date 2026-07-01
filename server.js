require('dotenv').config();
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

function patchRes(res) {
  res.status = function(code) { res._statusCode = code; return res; };
  res.json   = function(obj) {
    res.writeHead(res._statusCode || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  res.send = function(data) {
    res.writeHead(res._statusCode || 200);
    res.end(String(data));
  };
  const _end = res.end.bind(res);
  res.end = function(data) {
    if (!res.headersSent) res.writeHead(res._statusCode || 200);
    _end(data);
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  const fullUrl = new URL(req.url, `http://localhost:${PORT}`);
  const url = fullUrl.pathname;
  req.query = Object.fromEntries(fullUrl.searchParams);
  patchRes(res);

  // API routes
  if (url.startsWith('/api/')) {
    const handler = url.slice(1).replace(/\//g, path.sep);
    const file = path.join(__dirname, handler + '.js');
    if (!fs.existsSync(file)) { res.status(404).json({ error: 'Not found' }); return; }

    // Parse body para POST/PUT
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      if (body) try { req.body = JSON.parse(body); } catch {}
      try {
        delete require.cache[require.resolve(file)];
        await require(file)(req, res);
      } catch (e) {
        if (!res.headersSent) res.status(500).json({ error: e.message });
      }
    });
    return;
  }

  // Archivos estáticos desde public/
  let filePath = path.join(__dirname, 'public', url === '/' ? 'index.html' : url);
  if (!fs.existsSync(filePath)) filePath = path.join(__dirname, 'public', 'index.html');
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => console.log('JetSMART local: http://localhost:' + PORT));
