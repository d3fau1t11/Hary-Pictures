import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.resolve(__dirname, '..', 'dist');
const serverFile = path.join(distDir, 'index.html');

if (!fs.existsSync(serverFile)) {
  console.error('Dist not found. Run build first.');
  process.exit(1);
}

// Routes to prerender
const routes = ['/', '/portfolio', '/about', '/services', '/contact'];

// Start a tiny static server to serve dist locally to the headless browser
import http from 'http';
import mime from 'mime-types';

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  let filePath = path.resolve(distDir, '.' + reqPath);
  if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
    res.writeHead(403).end();
    return;
  }
  if (reqPath.endsWith('/')) filePath = path.join(distDir, reqPath, 'index.html');
  if (!fs.existsSync(filePath)) {
    // SPA fallback
    filePath = path.join(distDir, 'index.html');
  }
  const type = mime.lookup(filePath) || 'text/html';
  res.setHeader('Content-Type', type);
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((resolve) => server.listen(4173, '127.0.0.1', resolve));

const baseUrl = 'http://127.0.0.1:4173';

const browser = await puppeteer.launch({ 
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
try {
  const page = await browser.newPage();
  for (const route of routes) {
    const url = `${baseUrl}${route}`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    // Give React a moment to set titles/meta
    await new Promise((resolve) => setTimeout(resolve, 500));
    const html = await page.content();
    let outPath = path.join(distDir, route);
    if (!route.endsWith('/')) outPath += '/';
    fs.mkdirSync(outPath, { recursive: true });
    fs.writeFileSync(path.join(outPath, 'index.html'), html, 'utf8');
    console.log('Prerendered', route);
  }
} finally {
  await browser.close();
  server.close();
}

console.log('Prerender complete.');


