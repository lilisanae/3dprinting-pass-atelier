const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2] || 'dist');
const port = Number(process.env.PORT || 4173);
const mount = (process.env.BASE_PATH || '').replace(/\/+$/, '');
const address = `http://127.0.0.1:${port}${mount}/`;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.otf': 'font/otf',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('没有找到网站文件。请先生成 dist，或将预览脚本放在静态包中。');
  process.exit(1);
}
const server = http.createServer((req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (mount) {
      if (!pathname.startsWith(mount + '/')) {
        res.writeHead(404);
        res.end();
        return;
      }
      pathname = pathname.slice(mount.length);
    }
    let file = path.resolve(root, '.' + pathname);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory())
      file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end('没有找到这个文件');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Content-Length': fs.statSync(file).size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    res.writeHead(400);
    res.end();
  }
});
server.on('error', (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `端口 ${port} 已在使用，可打开 http://127.0.0.1:${port}/ 或设置 PORT 后重试。`
      : error.message,
  );
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(
    `通行证工坊已就绪：${address}\n关闭此窗口可结束预览。设计会自动保存在浏览器，也可下载项目文件。`,
  );
  if (process.env.PASS_OPEN_BROWSER === '1' && process.platform === 'win32') {
    const child = require('node:child_process').spawn(
      'rundll32.exe',
      ['url.dll,FileProtocolHandler', address],
      { windowsHide: true, stdio: 'ignore' },
    );
    child.on('error', () => console.log(`请手动打开 ${address}`));
    child.unref();
  }
});
