const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8756;
const ROOT = __dirname;

const TYPES = {
'.html': 'text/html; charset=utf-8',
'.css': 'text/css; charset=utf-8',
'.js': 'text/javascript; charset=utf-8',
'.json': 'application/json; charset=utf-8',
'.png': 'image/png',
'.svg': 'image/svg+xml',
'.ico': 'image/x-icon'
};

http.createServer((req, res) => {
let reqPath = decodeURIComponent(req.url.split('?')[0]);
if (reqPath === '/') reqPath = '/index.html';
const filePath = path.join(ROOT, reqPath);

if (!filePath.startsWith(ROOT)) {
res.writeHead(403);
res.end('Forbidden');
return;
}

fs.readFile(filePath, (err, data) => {
if (err) {
res.writeHead(404, { 'Content-Type': 'text/plain' });
res.end('Not found');
return;
}
const ext = path.extname(filePath);
res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
res.end(data);
});
}).listen(PORT, () => console.log('Serving on port ' + PORT));
