import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const port = Number(process.env.WORDRUSH_PREVIEW_PORT || 4334);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8','.mp4':'video/mp4','.wav':'audio/wav','.mp3':'audio/mpeg',
  '.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.ttf':'font/ttf',
  '.woff2':'font/woff2','.wasm':'application/wasm','.xml':'application/xml','.txt':'text/plain; charset=utf-8'};
http.createServer(async (req,res) => {
  try {
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405); return res.end();}
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    let file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (file !== root && !file.startsWith(root + path.sep)) {res.writeHead(403); return res.end();}
    let info = await stat(file);
    if (info.isDirectory()) {file = path.join(file,'index.html'); info = await stat(file);}
    if (!info.isFile()) throw new Error('Not a file');
    let start = 0, end = info.size - 1, status = 200;
    const headers = {'Content-Type':mime[path.extname(file)] || 'application/octet-stream','Accept-Ranges':'bytes',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/u.exec(req.headers.range);
      if (!match || !match[1] && !match[2]) {res.writeHead(416,{'Content-Range':`bytes */${info.size}`}); return res.end();}
      start = match[1] ? Number(match[1]) : Math.max(0,info.size-Number(match[2]));
      end = match[1] && match[2] ? Math.min(end,Number(match[2])) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) {
        res.writeHead(416,{'Content-Range':`bytes */${info.size}`}); return res.end();
      }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length'] = end-start+1;
    res.writeHead(status,headers);
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(file,{start,end});
    stream.on('error',() => res.destroy()); res.on('close',() => stream.destroy()); stream.pipe(res);
  } catch {if (!res.headersSent) res.writeHead(404); res.end('Not found');}
}).listen(port,'127.0.0.1',() => process.stdout.write(`Wordrush preview: http://127.0.0.1:${port}/browser-typing/\n`));
