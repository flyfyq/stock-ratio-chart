// 两只股票市值比值趋势图生成器
// 用法: node stock_ratio_chart.js <代码1> <代码2> [名称1] [名称2]
// 示例: node stock_ratio_chart.js sz300308 sz300502 中际旭创 新易盛

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('用法: node stock_ratio_chart.js <代码1> <代码2> [名称1] [名称2]');
  console.log('示例: node stock_ratio_chart.js sz300308 sz300502 中际旭创 新易盛');
  process.exit(1);
}

const code1 = args[0]; // e.g. sz300308 or sh600519
const code2 = args[1];
const name1 = args[2] || code1;
const name2 = args[3] || code2;

// Determine market prefix for Tencent API
function getFullCode(c) {
  if (c.startsWith('sz') || c.startsWith('sh')) return c;
  if (c.startsWith('60')) return 'sh' + c;
  return 'sz' + c;
}

const fullCode1 = getFullCode(code1);
const fullCode2 = getFullCode(code2);

function fetchKline(code) {
  const url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + code + ',day,,,1200,qfq';
  return httpGetPlain(url).then(raw => {
    const json = JSON.parse(raw);
    const list = json.data?.[code]?.qfqday || json.data?.[code]?.day || [];
    return list.map(row => ({ date: row[0], close: parseFloat(row[2]) }));
  });
}

function httpGetPlain(url) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(url, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function fetchTotalShares(code) {
  const url = 'http://qt.gtimg.cn/q=' + code;
  return httpGetPlain(url).then(raw => {
    const fields = raw.split('~');
    // Total shares (总股本) is typically at a specific position in Tencent qt format
    // Look for a ~1.1B-range number (for Chinese A-shares)
    let best = 0;
    for (let i = 0; i < fields.length; i++) {
      const v = parseInt(fields[i], 10);
      if (!isNaN(v) && v > 100000000 && v < 50000000000) {
        // Prefer larger value (total > circulating typically)
        if (v > best) best = v;
      }
    }
    if (best === 0) {
      console.error('Warning: Could not parse total shares for ' + code + ', raw fields:', fields.slice(40, 60));
    }
    return best;
  });
}

async function main() {
  console.log('正在获取 ' + name1 + '(' + fullCode1 + ') 数据...');
  console.log('正在获取 ' + name2 + '(' + fullCode2 + ') 数据...');

  const [kline1, kline2, shares1, shares2] = await Promise.all([
    fetchKline(fullCode1),
    fetchKline(fullCode2),
    fetchTotalShares(fullCode1),
    fetchTotalShares(fullCode2),
  ]);

  console.log(name1 + ': ' + kline1.length + ' 个交易日, 总股本 ' + (shares1 / 1e8).toFixed(2) + ' 亿股');
  console.log(name2 + ': ' + kline2.length + ' 个交易日, 总股本 ' + (shares2 / 1e8).toFixed(2) + ' 亿股');

  if (shares1 === 0 || shares2 === 0) {
    console.error('Error: Could not determine total shares for one or both stocks');
    process.exit(1);
  }

  // Build lookup by date for code2
  const map2 = {};
  kline2.forEach(r => { map2[r.date] = r.close; });

  // Calculate ratio for each day (using qfq close × current total shares)
  const ratios = [];
  kline1.forEach(r => {
    const close2 = map2[r.date];
    if (!close2 || close2 === 0) return;
    const mcap1 = r.close * shares1;
    const mcap2 = close2 * shares2;
    ratios.push({
      date: r.date,
      ratio: mcap1 / mcap2,
      mcap1: mcap1,
      mcap2: mcap2,
    });
  });

  console.log('有效数据点: ' + ratios.length);

  // Generate markers every 3 months from the first data point
  const firstDate = ratios[0].date;
  let [fy, fm] = firstDate.split('-').map(Number);
  // Round to nearest quarter start
  fm = Math.ceil(fm / 3) * 3;
  if (fm > 12) { fm -= 12; fy++; }

  const markers = [];
  let year = fy, month = fm;
  const lastDateStr = ratios[ratios.length - 1].date;

  while (true) {
    const prefix = year + '-' + String(month).padStart(2, '0');
    if (prefix > lastDateStr) break;

    let best = null;
    for (const r of ratios) {
      if (r.date.startsWith(prefix)) {
        if (!best || r.date < best.date) best = r;
      }
    }
    if (!best) {
      for (const r of ratios) {
        if (r.date >= prefix + '-01' && !best) best = r;
      }
    }
    if (best && !markers.find(m => m.date === best.date)) {
      markers.push(best);
    }

    month += 3;
    if (month > 12) { month -= 12; year++; }
  }

  console.log('标记点数量: ' + markers.length);

  // Generate HTML chart
  const dates = ratios.map(r => r.date);
  const ratioValues = ratios.map(r => r.ratio);
  const avgRatio = ratioValues.reduce((a, b) => a + b, 0) / ratioValues.length;
  const maxRatio = Math.max(...ratioValues);
  const minRatio = Math.min(...ratioValues);
  const current = ratioValues[ratioValues.length - 1];

  const dateRange = dates[0] + ' — ' + dates[dates.length - 1];

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset='utf-8'>
<title>${name1} / ${name2} 市值比值趋势</title>
<script src='https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js'><\/script>
<style>
  body { margin: 0; padding: 20px; background: #fff; font-family: 'Microsoft YaHei', sans-serif; }
  #chart { width: 100%; height: 680px; }
  .title { text-align: center; color: #222; font-size: 20px; font-weight: bold; margin-bottom: 5px; }
  .subtitle { text-align: center; color: #888; font-size: 13px; margin-bottom: 15px; }
  .note { text-align: center; color: #aaa; font-size: 11px; margin-top: 10px; }
  .summary-box { display: flex; justify-content: center; gap: 30px; margin: 15px 0; flex-wrap: wrap; }
  .stat { background: #f5f7fa; border-radius: 8px; padding: 12px 20px; text-align: center; min-width: 130px; border: 1px solid #e8e8e8; }
  .stat-val { color: #1890ff; font-size: 22px; font-weight: bold; }
  .stat-label { color: #999; font-size: 11px; margin-top: 3px; }
</style>
</head>
<body>
<div class='title'>${name1}(${code1.replace(/^sz|^sh/, '')}) / ${name2}(${code2.replace(/^sz|^sh/, '')}) 市值比值趋势</div>
<div class='subtitle'>${dateRange} | 市值 = 前复权收盘价 x 最新总股本 | 已考虑送转/增发/回购等股本变化</div>
<div class='summary-box'>
  <div class='stat'><div class='stat-val'>${current.toFixed(2)}</div><div class='stat-label'>最新比值</div></div>
  <div class='stat'><div class='stat-val'>${maxRatio.toFixed(2)}</div><div class='stat-label'>区间最高</div></div>
  <div class='stat'><div class='stat-val'>${minRatio.toFixed(2)}</div><div class='stat-label'>区间最低</div></div>
  <div class='stat'><div class='stat-val'>${avgRatio.toFixed(2)}</div><div class='stat-label'>区间均值</div></div>
</div>
<div id='chart'></div>
<div class='note'>红色虚线 = 比值=1 | 黄色实线 = 区间均值 | 红色标记 = 比值≥2 | 黄色 = 1.5~2 | 绿色 = <1.5 | 数据来源: 腾讯财经</div>

<script>
var chart = echarts.init(document.getElementById('chart'));

var dates = ${JSON.stringify(dates)};
var ratios = ${JSON.stringify(ratioValues)};
var markers = ${JSON.stringify(markers)};
var avgRatio = ${avgRatio.toFixed(4)};

var markPoints = markers.map(function(m) {
  var r = m.ratio;
  var color = r >= 2 ? '#ff4d4f' : r >= 1.5 ? '#faad14' : '#52c41a';
  var displayDate = m.date.substring(0,7);
  return {
    coord: [m.date, r],
    value: r.toFixed(2),
    symbol: 'pin',
    symbolSize: 48,
    itemStyle: { color: color },
    label: {
      show: true,
      color: '#fff',
      fontSize: 10,
      fontWeight: 'bold',
      backgroundColor: '#000',
      padding: [4, 8],
      borderRadius: 4,
      formatter: displayDate + '  ' + r.toFixed(2)
    }
  };
});

var option = {
  backgroundColor: '#fff',
  tooltip: {
    trigger: 'axis',
    backgroundColor: '#fff',
    borderColor: '#d9d9d9',
    textStyle: { color: '#333', fontSize: 13 },
    formatter: function(params) {
      var d = params[0].axisValue;
      var v = params[0].value;
      if (v > 1) {
        return '<b>' + d + '</b><br/>市值比值: <b style="color:#1890ff;font-size:16px">' + v.toFixed(3) + '</b><br/>${name1}市值 = ${name2} x ' + v.toFixed(2);
      } else {
        return '<b>' + d + '</b><br/>市值比值: <b style="color:#1890ff;font-size:16px">' + v.toFixed(3) + '</b><br/>${name2}市值 = ${name1} x ' + (1/v).toFixed(2);
      }
    }
  },
  grid: { left: 65, right: 50, top: 50, bottom: 55 },
  xAxis: {
    type: 'category',
    data: dates,
    axisLine: { lineStyle: { color: '#ccc' } },
    axisLabel: {
      color: '#888', fontSize: 10, rotate: 45,
      formatter: function(v) {
        var parts = v.split('-');
        if (parts[2] === '01' && parts[1] === '01') return parts[0];
        if (parts[2] === '01') return v.substring(0,7);
        return '';
      }
    },
    splitLine: { show: false },
    axisTick: { show: false }
  },
  yAxis: {
    type: 'value',
    name: '市值比值',
    nameTextStyle: { color: '#666', fontSize: 12 },
    axisLabel: { color: '#888', fontSize: 11 },
    axisLine: { lineStyle: { color: '#ccc' } },
    splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
    min: 1
  },
  dataZoom: [
    { type: 'inside', start: 0, end: 100 },
    { type: 'slider', start: 0, end: 100, height: 25, bottom: 8,
      borderColor: '#d9d9d9', backgroundColor: '#fafafa',
      fillerColor: 'rgba(24,144,255,0.2)',
      textStyle: { color: '#888' }
    }
  ],
  series: [
    {
      name: '市值比值 (${name1}/${name2})',
      type: 'line',
      data: ratios,
      smooth: true,
      symbol: 'none',
      lineStyle: { color: '#1890ff', width: 2 },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0,0,0,1, [
          {offset: 0, color: 'rgba(24,144,255,0.15)'},
          {offset: 1, color: 'rgba(24,144,255,0.02)'}
        ])
      },
      markLine: {
        silent: true,
        symbol: 'none',
        data: [
          {
            yAxis: 1,
            lineStyle: { color: '#ff4d4f', type: 'dashed', width: 1.5 },
            label: { color: '#ff4d4f', fontSize: 11, formatter: '比值=1', position: 'end' }
          },
          {
            yAxis: avgRatio,
            lineStyle: { color: '#faad14', type: 'solid', width: 2 },
            label: { color: '#d48806', fontSize: 11, formatter: '均值 ' + avgRatio.toFixed(2), position: 'end' }
          }
        ]
      },
      markPoint: {
        data: markPoints,
        animation: true
      }
    }
  ]
};

chart.setOption(option);
window.addEventListener('resize', function() { chart.resize(); });
</script>
</body>
</html>`;

  const outPath = path.join(os.homedir(), 'market_cap_ratio_chart.html');
  fs.writeFileSync(outPath, html);

  console.log('');
  console.log('========== 结果摘要 ==========');
  console.log('最新比值: ' + current.toFixed(2));
  console.log('区间最高: ' + maxRatio.toFixed(2) + ' (' + dates[ratioValues.indexOf(maxRatio)] + ')');
  console.log('区间最低: ' + minRatio.toFixed(2) + ' (' + dates[ratioValues.indexOf(minRatio)] + ')');
  console.log('区间均值: ' + avgRatio.toFixed(2));
  console.log('');
  console.log('图表已保存到: ' + outPath);
  console.log('浏览器已打开图表。');

  // Open in browser
  const { exec } = require('child_process');
  exec('start "" "' + outPath + '"');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
