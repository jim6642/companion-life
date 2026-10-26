import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('./ui/',import.meta.url));
const assets = { '/life': ['index.html','text/html; charset=utf-8'], '/life/': ['index.html','text/html; charset=utf-8'],
  '/life/app.js':['app.js','text/javascript; charset=utf-8'], '/life/style.css':['style.css','text/css; charset=utf-8'],
  '/life/assets/reading-room.png':['assets/reading-room.png','image/png'],
  '/life/assets/jingjing-avatar.png':['assets/jingjing-avatar.png','image/png'],
  '/life/assets/jingjing-study.png':['assets/jingjing-study.png','image/png'] };
export function serveLifePanel(req,res,pathname) {
  if(req.method==='GET'&&pathname==='/favicon.ico'){res.writeHead(204,{'cache-control':'no-store'});res.end();return true;}
  if(req.method!=='GET'||!assets[pathname])return false;
  const [file,type]=assets[pathname];
  res.writeHead(200,{'content-type':type,'cache-control':file.endsWith('.png')?'public, max-age=86400':'no-store',
    'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"});
  res.end(fs.readFileSync(path.join(dir,file)));return true;
}
