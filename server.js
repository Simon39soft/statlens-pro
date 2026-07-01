const express = require('express');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 52428800 } });
app.use(cors());
app.use(express.json({ limit: '50mb' }));

var lastAnalysis = null;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'StatLens Pro backend is running' });
});

function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
    const row = {};
    headers.forEach((h, j) => { row[h] = vals[j] || ''; });
    rows.push(row);
  }
  return { headers, rows };
}

function getNumericCols(rows, headers) {
  const cols = [];
  headers.forEach(h => {
    const vals = rows.map(r => parseFloat(r[h])).filter(v => !isNaN(v));
    if (vals.length > rows.length * 0.5) cols.push({ name: h, values: vals });
  });
  return cols;
}

function calcStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length/2 - 1] + sorted[sorted.length/2]) / 2
    : sorted[Math.floor(sorted.length/2)];
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  return { mean: Math.round(mean), median: Math.round(median), std: Math.round(Math.sqrt(variance)), min: Math.round(sorted[0]), max: Math.round(sorted[sorted.length - 1]) };
}

function countMissing(rows, headers) {
  let m = 0;
  rows.forEach(row => { headers.forEach(h => { if (!row[h] || row[h] === '') m++; }); });
  return m;
}

function countDupes(rows) {
  const seen = new Set(); let d = 0;
  rows.forEach(row => { const k = JSON.stringify(row); if (seen.has(k)) d++; else seen.add(k); });
  return d;
}

function detectAnomalies(cols) {
  const anomalies = [];
  cols.forEach(col => {
    const mean = col.values.reduce((a, b) => a + b, 0) / col.values.length;
    const std = Math.sqrt(col.values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / col.values.length);
    col.values.forEach((v, i) => { if (Math.abs(v - mean) > 2 * std) anomalies.push({ col: col.name, index: i + 1, value: v }); });
  });
  return anomalies;
}

app.post('/api/analyze/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const file = req.file;
    const mimeType = file.mimetype;
    const fileName = file.originalname;
    if (mimeType === 'text/csv' || fileName.endsWith('.csv')) {
      const text = file.buffer.toString('utf-8');
      const parsed = parseCSV(text);
      if (!parsed) return res.json({ success: true, analysis: { insights: 'Could not parse CSV.', financials: { rows:0,cols:0,missing:0,dupes:0,quality:0,mean:0,median:0,std:0,min:0,max:0,profit:0,loss:0,expenses:0 }, chartData: [], summary: {} } });
      const { headers, rows } = parsed;
      const numCols = getNumericCols(rows, headers);
      const missing = countMissing(rows, headers);
      const dupes = countDupes(rows);
      const anomalies = detectAnomalies(numCols);
      const quality = Math.max(0, Math.min(100, Math.round(100 - (missing / (rows.length * headers.length) * 100) - (dupes / rows.length * 10))));
      let stats = { mean:0, median:0, std:0, min:0, max:0 };
      if (numCols.length > 0) stats = calcStats(numCols[0].values);
      const find = (k) => numCols.find(c => c.name.toLowerCase().includes(k));
      const sum = (col) => col ? Math.round(col.values.reduce((a,b) => a+b, 0)) : 0;
      const avg = (col) => col ? Math.round(col.values.reduce((a,b) => a+b, 0) / col.values.length) : 0;
      const revCol = find('revenue') || find('sales') || find('income');
      const profitCol = find('profit');
      const lossCol = find('loss');
      const expCol = find('expense') || find('cost');
      const custCol = find('customer') || find('client');
      const totalRev = sum(revCol);
      const totalProfit = sum(profitCol);
      const totalLoss = sum(lossCol);
      const totalExp = sum(expCol);
      const avgRev = avg(revCol);
      const avgProfit = avg(profitCol);
      const topMonth = revCol ? rows[revCol.values.indexOf(Math.max.apply(null, revCol.values))] : null;
      const worstMonth = revCol ? rows[revCol.values.indexOf(Math.min.apply(null, revCol.values))] : null;
      const profitMargin = totalRev > 0 && totalProfit > 0 ? Math.round((totalProfit / totalRev) * 100) : 0;
      const lossMonths = lossCol ? lossCol.values.filter(v => v > 0).length : 0;
      let insights = 'Dataset: ' + rows.length + ' records across ' + headers.length + ' columns. ';
      if (totalRev > 0) insights += 'Total revenue: $' + totalRev.toLocaleString() + ' with monthly average of $' + avgRev.toLocaleString() + '. ';
      if (totalProfit > 0) insights += 'Total profit: $' + totalProfit.toLocaleString() + ' (avg $' + avgProfit.toLocaleString() + '/month). ';
      if (profitMargin > 0) insights += 'Profit margin: ' + profitMargin + '%. ';
      if (totalLoss > 0) insights += lossMonths + ' loss period(s) totalling $' + totalLoss.toLocaleString() + '. ';
      if (totalExp > 0) insights += 'Total expenses: $' + totalExp.toLocaleString() + '. ';
      if (topMonth) insights += 'Best month: ' + (topMonth.month || topMonth.date || 'record ' + (revCol.values.indexOf(Math.max.apply(null,revCol.values))+1)) + ' ($' + Math.max.apply(null,revCol.values).toLocaleString() + '). ';
      if (anomalies.length > 0) insights += anomalies.length + ' anomaly(ies) detected. ';
      insights += 'Quality score: ' + quality + '%.';
      lastAnalysis = { rows, headers, numCols, stats, totalRev, totalProfit, totalLoss, totalExp, avgRev, avgProfit, profitMargin, lossMonths, anomalies, quality, missing, dupes, topMonth, worstMonth, custCol, fileName };
      const chartData = numCols.slice(0, 4).map(c => ({ name: c.name, values: c.values }));
      return res.json({ success: true, analysis: { insights, anomalies: anomalies.length, chartData, financials: { rows:rows.length, cols:headers.length, missing, dupes, quality, mean:stats.mean, median:stats.median, std:stats.std, min:stats.min, max:stats.max, profit:totalProfit, loss:totalLoss, expenses:totalExp } } });
    } else {
      return res.json({ success: true, analysis: { insights: 'File received: ' + fileName + '. Upload a CSV for full analysis.', anomalies: 0, chartData: [], financials: { rows:0,cols:0,missing:0,dupes:0,quality:85,mean:0,median:0,std:0,min:0,max:0,profit:0,loss:0,expenses:0 } } });
    }
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/ask', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ success: false, message: 'No question provided' });
    const q = question.toLowerCase();
    let answer = '';
    if (!lastAnalysis) {
      answer = 'No data has been analyzed yet. Please upload a CSV file and run analysis first, then ask me questions about your specific data.';
      return res.json({ success: true, answer });
    }
    const d = lastAnalysis;
    if (q.includes('top 5') || q.includes('highest') || q.includes('best')) {
      if (d.numCols.length > 0) {
        const col = d.numCols[0];
        const sorted = [...col.values].map((v,i) => ({v,i})).sort((a,b) => b.v-a.v).slice(0,5);
        answer = 'Top 5 values in ' + col.name + ': ' + sorted.map((s,i) => (i+1)+'. $'+s.v.toLocaleString()+' (record '+(s.i+1)+')').join(', ') + '. ';
        if (d.topMonth) answer += 'Your best overall period was ' + (d.topMonth.month || d.topMonth.date || 'record') + ' with $' + Math.max.apply(null, col.values).toLocaleString() + '.';
      }
    } else if (q.includes('revenue') || q.includes('sales') || q.includes('income')) {
      answer = 'Total revenue from your data: $' + d.totalRev.toLocaleString() + '. Monthly average: $' + d.avgRev.toLocaleString() + '. ';
      if (d.profitMargin > 0) answer += 'Your profit margin is ' + d.profitMargin + '%. ';
      if (d.profitMargin < 20) answer += 'Recommendation: Your margin is low. Focus on reducing expenses or increasing prices to improve profitability.';
      else if (d.profitMargin >= 50) answer += 'Recommendation: Excellent margin. Consider reinvesting profits into growth — marketing, new products, or hiring.';
      else answer += 'Recommendation: Good margin. Maintain current cost controls while exploring revenue growth opportunities.';
    } else if (q.includes('profit')) {
      answer = 'Total profit: $' + d.totalProfit.toLocaleString() + '. Average monthly profit: $' + d.avgProfit.toLocaleString() + '. Profit margin: ' + d.profitMargin + '%. ';
      if (d.lossMonths > 0) answer += d.lossMonths + ' loss period(s) detected totalling $' + d.totalLoss.toLocaleString() + '. Investigate those periods — check for unusually high expenses or low sales. ';
      answer += 'Action: Focus on the months with lowest profit and identify what drove lower performance.';
    } else if (q.includes('loss') || q.includes('problem') || q.includes('worst') || q.includes('bad')) {
      if (d.totalLoss > 0) {
        answer = d.lossMonths + ' loss period(s) found totalling $' + d.totalLoss.toLocaleString() + '. ';
        if (d.worstMonth) answer += 'Worst period: ' + (d.worstMonth.month || d.worstMonth.date || 'identified record') + '. ';
        answer += 'Recommendation: Review what happened during loss periods — were expenses unusually high? Did revenue drop? Compare against your best months to identify the key differences.';
      } else { answer = 'Good news — no loss periods detected in your data. All periods show positive performance.'; }
    } else if (q.includes('expense') || q.includes('cost')) {
      answer = 'Total expenses: $' + d.totalExp.toLocaleString() + '. ';
      if (d.totalRev > 0) { const expRatio = Math.round((d.totalExp / d.totalRev) * 100); answer += 'Expense ratio: ' + expRatio + '% of revenue. '; if (expRatio > 70) answer += 'Recommendation: Expenses are high relative to revenue. Audit your largest cost categories and identify areas to cut without hurting quality.'; else answer += 'Recommendation: Expense ratio is healthy. Maintain current cost discipline.'; }
    } else if (q.includes('anomaly') || q.includes('outlier') || q.includes('unusual')) {
      if (d.anomalies.length > 0) {
        answer = d.anomalies.length + ' anomaly(ies) detected: ';
        answer += d.anomalies.slice(0,3).map(a => a.col + ' record ' + a.index + ' (value: ' + a.value.toLocaleString() + ')').join(', ') + '. ';
        answer += 'Recommendation: Investigate these records. They may represent errors, fraud, exceptional events, or genuine opportunities worth exploring.';
      } else { answer = 'No statistical anomalies detected. All values fall within 2 standard deviations of the mean — your data is consistent.'; }
    } else if (q.includes('trend') || q.includes('over time') || q.includes('growth')) {
      if (d.numCols.length > 0) {
        const col = d.numCols[0];
        const first = col.values.slice(0,3).reduce((a,b)=>a+b,0)/3;
        const last = col.values.slice(-3).reduce((a,b)=>a+b,0)/3;
        const growth = Math.round(((last-first)/first)*100);
        answer = 'Trend analysis for ' + col.name + ': ';
        if (growth > 0) answer += 'Growing at approximately ' + growth + '% over the period. ';
        else if (growth < 0) answer += 'Declining by approximately ' + Math.abs(growth) + '% over the period. ';
        else answer += 'Relatively stable over the period. ';
        answer += 'Starting average: $' + Math.round(first).toLocaleString() + '. Recent average: $' + Math.round(last).toLocaleString() + '. ';
        if (growth > 10) answer += 'Recommendation: Strong growth trajectory. Scale what is working — double down on your best performing months strategies.';
        else if (growth < -10) answer += 'Recommendation: Declining trend requires urgent attention. Review pricing, customer retention, and market conditions.';
        else answer += 'Recommendation: Stable but flat. Look for ways to accelerate growth through new customer acquisition or product expansion.';
      }
    } else if (q.includes('summarize') || q.includes('summary') || q.includes('overview')) {
      answer = 'Summary of your ' + d.fileName + ':\n\n';
      answer += 'Dataset: ' + d.rows.length + ' records, ' + d.headers.length + ' columns.\n';
      if (d.totalRev > 0) answer += 'Revenue: $' + d.totalRev.toLocaleString() + ' total.\n';
      if (d.totalProfit > 0) answer += 'Profit: $' + d.totalProfit.toLocaleString() + ' (' + d.profitMargin + '% margin).\n';
      if (d.totalLoss > 0) answer += 'Loss periods: ' + d.lossMonths + ' month(s), $' + d.totalLoss.toLocaleString() + ' total.\n';
      if (d.totalExp > 0) answer += 'Expenses: $' + d.totalExp.toLocaleString() + ' total.\n';
      answer += 'Anomalies: ' + d.anomalies.length + '. Quality: ' + d.quality + '%.\n\n';
      answer += 'Key recommendation: ';
      if (d.profitMargin >= 50) answer += 'Business is performing well. Focus on scaling revenue while maintaining margins.';
      else if (d.totalLoss > 0) answer += 'Address loss periods first — they are your biggest opportunity for improvement.';
      else answer += 'Solid foundation. Optimize expenses and accelerate revenue growth.';
    } else if (q.includes('recommend') || q.includes('advice') || q.includes('what should') || q.includes('what to do')) {
      answer = 'Based on your data, here are my recommendations:\n\n';
      if (d.totalLoss > 0) answer += '1. Investigate your ' + d.lossMonths + ' loss period(s) — find what caused them and prevent recurrence.\n';
      if (d.anomalies.length > 0) answer += '2. Review ' + d.anomalies.length + ' anomalous data points — they may represent errors or opportunities.\n';
      if (d.profitMargin > 0 && d.profitMargin < 30) answer += '3. Improve profit margin (currently ' + d.profitMargin + '%) by reducing costs or raising prices.\n';
      if (d.missing > 0) answer += '4. Fix ' + d.missing + ' missing values in your dataset for more accurate analysis.\n';
      if (d.profitMargin >= 50) answer += 'Your margins are strong. Focus on growth — expand to new markets, increase marketing spend, or launch new products.\n';
      answer += '\nUpload updated data regularly to track your progress.';
    } else if (q.includes('quality') || q.includes('data quality') || q.includes('clean')) {
      answer = 'Data quality score: ' + d.quality + '%. ';
      if (d.missing > 0) answer += d.missing + ' missing values found. ';
      if (d.dupes > 0) answer += d.dupes + ' duplicate rows detected. ';
      if (d.quality >= 90) answer += 'Excellent quality — your data is clean and reliable for analysis.';
      else if (d.quality >= 70) answer += 'Good quality. Clean missing values and remove duplicates for even better accuracy.';
      else answer += 'Quality needs improvement. Fix missing values and duplicates before making major decisions from this data.';
    } else if (q.includes('mean') || q.includes('average')) {
      answer = 'Mean (average) of your primary numeric column: ' + d.stats.mean.toLocaleString() + '. Median: ' + d.stats.median.toLocaleString() + '. The median being ' + (d.stats.median > d.stats.mean ? 'higher' : 'lower') + ' than the mean suggests ' + (d.stats.median > d.stats.mean ? 'some lower outliers pulling the average down.' : 'some higher outliers pulling the average up.');
    } else if (q.includes('median')) {
      answer = 'Median value: ' + d.stats.median.toLocaleString() + '. This is the middle value of your dataset when sorted. It is more reliable than the mean when outliers exist. Your mean is ' + d.stats.mean.toLocaleString() + ' — a ' + (Math.abs(d.stats.mean - d.stats.median) / d.stats.median * 100).toFixed(1) + '% difference from the median.';
    } else if (q.includes('std') || q.includes('standard deviation') || q.includes('spread') || q.includes('variation')) {
      answer = 'Standard deviation: ' + d.stats.std.toLocaleString() + '. This measures how spread out your values are. ';
      const cv = Math.round((d.stats.std / d.stats.mean) * 100);
      answer += 'Coefficient of variation: ' + cv + '%. ';
      if (cv < 20) answer += 'Your data is highly consistent — low variation between periods.';
      else if (cv < 50) answer += 'Moderate variation — some fluctuation between periods, which is normal for most businesses.';
      else answer += 'High variation — significant swings between periods. Investigate the causes of this volatility.';
    } else if (q.includes('customer') || q.includes('client')) {
      if (d.custCol) {
        const total = Math.round(d.custCol.values.reduce((a,b)=>a+b,0));
        const avg = Math.round(total / d.custCol.values.length);
        answer = 'Total customers across all periods: ' + total.toLocaleString() + '. Average per period: ' + avg.toLocaleString() + '. ';
        if (d.totalRev > 0) answer += 'Revenue per customer: $' + Math.round(d.totalRev / total).toLocaleString() + '. ';
        answer += 'Recommendation: Focus on increasing revenue per customer through upselling, and reduce churn by improving customer experience.';
      } else { answer = 'No customer column detected in your data. Add a customers or clients column to get customer-specific insights.'; }
    } else {
      answer = 'Based on your ' + d.fileName + ' data (' + d.rows.length + ' records, quality: ' + d.quality + '%): ';
      if (d.totalRev > 0) answer += 'Revenue $' + d.totalRev.toLocaleString() + ', profit $' + d.totalProfit.toLocaleString() + ' (' + d.profitMargin + '% margin). ';
      answer += 'Try asking: "What is my profit margin?", "Show me the trend", "What are my top 5 values?", "Any anomalies?", "Give me recommendations", or "Summarize this dataset".';
    }
    return res.json({ success: true, answer });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, function() {
  console.log('StatLens running on port ' + PORT);
});
