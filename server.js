const express = require('express');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 52428800 } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

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
  return {
    mean: Math.round(mean),
    median: Math.round(median),
    std: Math.round(Math.sqrt(variance)),
    min: Math.round(sorted[0]),
    max: Math.round(sorted[sorted.length - 1])
  };
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
    col.values.forEach((v, i) => {
      if (Math.abs(v - mean) > 2 * std) anomalies.push({ col: col.name, index: i + 1, value: v });
    });
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
      if (!parsed) return res.json({ success: true, analysis: { insights: 'Could not parse CSV. Check format.', financials: { rows:0,cols:0,missing:0,dupes:0,quality:0,mean:0,median:0,std:0,min:0,max:0,profit:0,loss:0,expenses:0 }, chartData: [] } });

      const { headers, rows } = parsed;
      const numCols = getNumericCols(rows, headers);
      const missing = countMissing(rows, headers);
      const dupes = countDupes(rows);
      const anomalies = detectAnomalies(numCols);
      const quality = Math.max(0, Math.min(100, Math.round(100 - (missing / (rows.length * headers.length) * 100) - (dupes / rows.length * 10))));

      let stats = { mean:0, median:0, std:0, min:0, max:0 };
      if (numCols.length > 0) stats = calcStats(numCols[0].values);

      const find = (keyword) => numCols.find(c => c.name.toLowerCase().includes(keyword));
      const sum = (col) => col ? Math.round(col.values.reduce((a,b) => a+b, 0)) : 0;

      const revCol = find('revenue') || find('sales') || find('income');
      const profitCol = find('profit');
      const lossCol = find('loss');
      const expCol = find('expense');

      const totalRev = sum(revCol);
      const totalProfit = sum(profitCol);
      const totalLoss = sum(lossCol);
      const totalExp = sum(expCol);
      const avgRev = revCol ? Math.round(totalRev / revCol.values.length) : 0;

      let insights = 'Dataset: ' + rows.length + ' records, ' + headers.length + ' columns. ';
      if (totalRev > 0) insights += 'Total revenue $' + totalRev.toLocaleString() + ', monthly average $' + avgRev.toLocaleString() + '. ';
      if (totalProfit > 0) insights += 'Total profit $' + totalProfit.toLocaleString() + '. ';
      if (totalLoss > 0) insights += 'Loss periods detected totalling $' + totalLoss.toLocaleString() + ' — review these months. ';
      if (totalExp > 0) insights += 'Total expenses $' + totalExp.toLocaleString() + '. ';
      if (anomalies.length > 0) insights += anomalies.length + ' statistical anomalies detected. ';
      if (missing > 0) insights += missing + ' missing values. ';
      insights += 'Quality score ' + quality + '%.';

      const chartData = numCols.slice(0, 4).map(c => ({ name: c.name, values: c.values }));

      return res.json({
        success: true,
        analysis: {
          insights,
          anomalies: anomalies.length,
          chartData,
          financials: { rows:rows.length, cols:headers.length, missing, dupes, quality, mean:stats.mean, median:stats.median, std:stats.std, min:stats.min, max:stats.max, profit:totalProfit, loss:totalLoss, expenses:totalExp }
        }
      });

    } else {
      return res.json({ success: true, analysis: { insights: 'File ' + fileName + ' received. Upload a CSV for full statistical analysis.', anomalies: 0, chartData: [], financials: { rows:0,cols:0,missing:0,dupes:0,quality:85,mean:0,median:0,std:0,min:0,max:0,profit:0,loss:0,expenses:0 } } });
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
    if (q.includes('revenue') || q.includes('sales')) answer = 'Revenue analysis requires your uploaded data. Upload a CSV with a revenue column to see totals, trends and monthly breakdowns.';
    else if (q.includes('profit')) answer = 'Profit is calculated as revenue minus expenses. Upload your financial CSV to see your exact profit margins and trends.';
    else if (q.includes('anomaly') || q.includes('outlier')) answer = 'StatLens detects anomalies using 2-standard-deviation analysis. Any value more than 2x the standard deviation from the mean is flagged.';
    else if (q.includes('trend')) answer = 'Trend analysis compares values across time periods. Upload a CSV with date and value columns to see your trend chart.';
    else if (q.includes('quality')) answer = 'Data quality score is calculated based on missing values, duplicate rows, and data completeness across all columns.';
    else if (q.includes('mean') || q.includes('average')) answer = 'The mean is the arithmetic average of all values in a column. StatLens calculates this automatically from your uploaded CSV.';
    else if (q.includes('median')) answer = 'The median is the middle value when all data points are sorted. It is more robust than the mean when outliers are present.';
    else answer = 'Upload a CSV file and run analysis to get specific answers about your data. StatLens will analyze your exact numbers and provide detailed insights.';
    return res.json({ success: true, answer });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, function() {
  console.log('StatLens Pro running on port ' + PORT);
});
