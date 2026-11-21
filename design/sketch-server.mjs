#!/usr/bin/env node
/**
 * 涂鸦板本地小服务器：托管 design/sketch.html，把画的草图存进 design/sketches/。
 * 启动：npm run sketch   （或 node design/sketch-server.mjs）
 * 只监听 127.0.0.1，不会暴露到局域网。
 */
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'sketches');
const PORT = Number(process.env.SKETCH_PORT) || 7788;
const MAX_BODY = 10 * 1024 * 1024;

await mkdir(outDir, { recursive: true });

const stamp = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function safeName(raw) {
  let name = String(raw || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 60);
  if (!name.toLowerCase().endsWith('.png')) name += '.png';
  return name || `sketch-${stamp()}.png`;
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return send(res, 204, 'text/plain', '');

  const url = new URL(req.url, 'http://localhost');

  // 保存草图：POST /api/save?name=xxx.png，body 为 PNG 二进制
  if (req.method === 'POST' && url.pathname === '/api/save') {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BODY) { res.destroy(); return; }
      chunks.push(chunk);
    }
    const file = safeName(url.searchParams.get('name'));
    const stem = file.slice(0, -4);
    let finalName = file, i = 1;
    while (existsSync(path.join(outDir, finalName))) finalName = `${stem}-${i++}.png`; // 重名不覆盖
    try {
      await writeFile(path.join(outDir, finalName), Buffer.concat(chunks));
    } catch (err) {
      return send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ ok: false, error: String(err) }));
    }
    return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, file: finalName }));
  }

  if (req.method === 'GET' && url.pathname === '/api/ping') {
    return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true }));
  }

  if (req.method === 'GET' && url.pathname === '/api/list') {
    const files = (await readdir(outDir)).filter(f => f.endsWith('.png')).sort().reverse();
    return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ files }));
  }

  // 静态文件（限制在本目录内，防目录穿越）
  if (req.method === 'GET') {
    const rel = url.pathname === '/' ? '/sketch.html' : decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(here, rel));
    if (!file.startsWith(here)) return send(res, 403, 'text/plain; charset=utf-8', '403');
    try {
      const data = await readFile(file);
      const type = file.endsWith('.html') ? 'text/html; charset=utf-8'
        : file.endsWith('.png') ? 'image/png'
        : file.endsWith('.svg') ? 'image/svg+xml'
        : 'text/plain; charset=utf-8';
      return send(res, 200, type, data);
    } catch {
      return send(res, 404, 'text/plain; charset=utf-8', '404 Not Found');
    }
  }

  send(res, 404, 'text/plain; charset=utf-8', '404');
}).listen(PORT, '127.0.0.1', () => {
  const u = `http://127.0.0.1:${PORT}/`;
  console.log(`涂鸦板已启动 → ${u}   （草图保存在 design/sketches/，Ctrl+C 退出）`);
  if (process.platform === 'win32' && !process.env.SKETCH_NO_OPEN) exec(`start "" "${u}"`);
});
