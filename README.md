# Stock Ratio Chart

> 一键生成两只 A 股的历史市值比值趋势图

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 效果

输入两只股票，自动生成带标记点的交互式市值比值趋势图：

![示例图表](https://via.placeholder.com/800x400/ffffff/333?text=Market+Cap+Ratio+Chart+Example)

## 快速开始

### 前提要求
- Node.js >= 14

### 安装
```bash
git clone https://github.com/YOUR_USERNAME/stock-ratio-chart.git
cd stock-ratio-chart
npm install  # 无额外依赖，仅需 Node.js 内置模块
```

### 使用
```bash
# 基本用法：代码1 代码2 [名称1] [名称2]
node stock_ratio_chart.js sz300308 sz300502 中际旭创 新易盛

# 代码格式：sz/shh + 数字，或直接 6 位数字（60xxxx 自动归为上海，其余归为深圳）
node stock_ratio_chart.js 300308 300502 中际旭创 新易盛
node stock_ratio_chart.js 600519 000858 贵州茅台 五粮液
node stock_ratio_chart.js 002475 601138 立讯精密 工业富联
node stock_ratio_chart.js 300750 002594 宁德时代 比亚迪
```

图表会自动保存到用户目录并在浏览器中打开。

## 工作原理

1. 从腾讯财经获取前复权（qfq）日 K 线数据（约 640 个交易日 / 3-4 年）
2. 从腾讯 qt 接口获取最新总股本
3. **市值 = 前复权收盘价 × 最新总股本**（前复权已内生处理送转、增发、分红等所有股本变动）
4. 计算每日市值比值，生成交互式 HTML 图表

## 图表特性

- 🎨 白色背景，蓝色曲线 + 浅蓝面积填充
- 📍 每 3 个月标记点：日期和比值同行展示，黑色背景
  - 🔴 红色标记：比值 ≥ 2
  - 🟡 黄色标记：1.5 ≤ 比值 < 2
  - 🟢 绿色标记：比值 < 1.5
- 📏 顶部数据卡片：最新比值、最高、最低、均值
- 📈 黄色实线 = 区间均值，红色虚线 = 比值 = 1
- 🔍 支持缩放拖动、悬停查看每日精确值

## 数据说明

- **数据源**：腾讯财经
- **市场**：沪深 A 股
- **时间范围**：约 3-4 年日线数据
- 使用**前复权**价格，无需手动处理送转分红等除权事件

## 项目结构

```
stock-ratio-chart/
├── package.json          # 项目元信息
├── LICENSE               # MIT 许可
├── README.md             # 本文件
└── stock_ratio_chart.js  # 主脚本（零外部依赖）
```

## 许可

MIT
