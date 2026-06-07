// 股票市值比值图表 - 本地服务器
// 用法: node server.js
// 然后浏览器打开 http://localhost:3456

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3456;

// MIME types
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
};

// 代理 API 请求
function proxyRequest(url, res, contentType) {
  const ct = contentType || 'application/json; charset=utf-8';
  const mod = url.startsWith('https') ? https : http;
  mod.get(url, { rejectUnauthorized: false, headers: { 'User-Agent': 'Mozilla/5.0' } }, (proxyRes) => {
    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    });
  }).on('error', (e) => {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  });
}

// 异步获取 URL 内容
function fetchUrl(url, opts) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, Object.assign({ rejectUnauthorized: false, timeout: 8000 }, opts || {}), (proxyRes) => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// 交叉校验：对比腾讯 vs 东方财富/新浪数据
async function verifyStockData(code) {
  const txUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,50,qfq`;
  const emUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${code.startsWith('sz') ? '0.' : '1.'}${code.substring(2)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&lmt=50`;

  const [txRaw, emRaw] = await Promise.all([
    fetchUrl(txUrl),
    fetchUrl(emUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com/' } }),
  ]);

  if (!txRaw) return { status: 'error', message: '腾讯数据源不可达' };

  let txData, txKlines;
  try {
    txData = JSON.parse(txRaw);
    txKlines = txData.data?.[code]?.qfqday || [];
  } catch (e) {
    return { status: 'error', message: '腾讯数据解析失败' };
  }

  // 如果东方财富不可用，尝试新浪
  let secondarySource = '东方财富';
  let secondaryKlines = null;

  if (emRaw) {
    try {
      const emData = JSON.parse(emRaw);
      secondaryKlines = (emData.data?.klines || []).map(r => {
        const p = r.split(',');
        return [p[0], p[2]]; // [date, close]
      });
    } catch (e) { /* fall through */ }
  }

  // 东方财富失败，尝试新浪
  if (!secondaryKlines) {
    secondarySource = '新浪财经';
    const sinaUrl = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${code}&scale=240&ma=no&datalen=50`;
    const sinaRaw = await fetchUrl(sinaUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.sina.com.cn' } });
    if (sinaRaw) {
      try {
        const sinaData = JSON.parse(sinaRaw);
        // 新浪返回不复权价格，用2025-06以后的数据避免送转影响
        secondaryKlines = sinaData.filter(r => r.day >= '2025-06-01').map(r => [r.day, r.close]);
      } catch (e) { /* fall through */ }
    }
  }

  if (!secondaryKlines) {
    return { status: 'warning', message: '无第二数据源可对比，仅使用腾讯数据', source: '腾讯财经' };
  }

  // 选取 5 个均匀分布的日期进行对比
  const txMap = {};
  txKlines.forEach(r => { txMap[r[0]] = parseFloat(r[2]); });

  const seMap = {};
  secondaryKlines.forEach(r => { seMap[r[0]] = parseFloat(r[1]); });

  const spotDates = txKlines
    .filter(r => seMap[r[0]])
    .filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 5)) === 0)
    .slice(0, 5)
    .map(r => r[0]);

  if (spotDates.length === 0) {
    return { status: 'warning', message: '两数据源无重叠日期，仅使用腾讯数据', source: '腾讯财经' };
  }

  const checks = [];
  let maxDiff = 0;
  for (const d of spotDates) {
    const txClose = txMap[d];
    const seClose = seMap[d];
    const diff = Math.abs(txClose - seClose);
    if (diff > maxDiff) maxDiff = diff;
    checks.push({ date: d, tx: txClose, secondary: seClose, diff: diff });
  }

  // 阈值：东方财富(前复权)严格对比；新浪(不复权)使用相对阈值
  const isSecondaryAdjusted = secondarySource === '东方财富';
  const absThreshold = isSecondaryAdjusted ? 0.02 : 0.05;  // 绝对阈值
  const relThreshold = isSecondaryAdjusted ? 0.001 : 0.002; // 相对阈值 0.1%/0.2%
  const avgPrice = checks.reduce((s, c) => s + c.tx, 0) / checks.length;
  const effectiveThreshold = Math.max(absThreshold, avgPrice * relThreshold);

  if (maxDiff <= effectiveThreshold) {
    return {
      status: 'ok',
      message: `✅ 数据验证通过 — 腾讯财经 vs ${secondarySource}，${checks.length}个抽查点最大差异 ${maxDiff.toFixed(4)}元`,
      source: '腾讯财经',
      secondarySource,
      checks,
      maxDiff,
    };
  } else {
    return {
      status: 'mismatch',
      message: `⚠️ 数据存在差异 — 腾讯财经 vs ${secondarySource}，${checks.length}个抽查点最大差异 ${maxDiff.toFixed(4)}元`,
      source: '腾讯财经',
      secondarySource,
      checks,
      maxDiff,
    };
  }
}

const server = http.createServer((req, res) => {
  const reqUrl = req.url.split('?')[0];

  // API 代理
  if (reqUrl === '/api/kline') {
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const code = params.get('code');
    if (!code) { res.writeHead(400); res.end('Missing code'); return; }
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,1200,qfq`;
    return proxyRequest(url, res);
  }

  if (reqUrl === '/api/verify') {
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const code1 = params.get('code1');
    const code2 = params.get('code2');
    if (!code1 || !code2) { res.writeHead(400); res.end('Missing code1/code2'); return; }
    verifyStockData(code1).then(r1 => {
      verifyStockData(code2).then(r2 => {
        const overallStatus = (r1.status === 'ok' && r2.status === 'ok') ? 'ok' :
                              (r1.status === 'error' || r2.status === 'error') ? 'error' : 'warning';
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          status: overallStatus,
          stocks: { [code1]: r1, [code2]: r2 },
          message: (r1.status === 'ok' && r2.status === 'ok') ? '✅ 双数据源交叉验证通过' : '⚠️ 验证存在警告',
        }));
      });
    });
    return;
  }

  if (reqUrl === '/api/search') {
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const q = params.get('q');
    if (!q) { res.writeHead(400); res.end('Missing q'); return; }
    const url = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(q)}&t=all&c=zx`;
    const opts = { rejectUnauthorized: false, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' } };
    const mod = https;
    mod.get(url, opts, (proxyRes) => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      });
    }).on('error', (e) => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  // 静态文件
  let filePath = reqUrl === '/' ? '/index.html' : reqUrl;
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`✅ 股票市值比值图表服务已启动`);
  console.log(`   👉 打开浏览器访问: http://localhost:${PORT}`);
  console.log(`   📌 可以将此地址加入书签`);
  console.log(``);

  // 自动打开浏览器
  const { exec } = require('child_process');
  exec(`start http://localhost:${PORT}`);
});
