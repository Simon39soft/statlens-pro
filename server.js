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

function getNumericValues(rows, headers) {
  const numericCols = [];
  headers.forEach(h => {
    const vals = rows.map(r => parseFloat(r[h])).filter(v => !isNaN(v));
    if (vals.length > rows.length * 0.5) numericCols.push({ name: h, values: vals });
  });
  return numericCols;
}

function calcStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length/2 - 1] + sorted[sorted.length/2]) / 2
    : sorted[Math.floor(sorted.length/2)];
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  const std = Math.sqrt(variance);
  return {
    mean: Math.round(mean),
    median: Math.round(median),
    std: Math.round(std),
    min: Math.round(sorted[0]),
    max: Math.round(sorted[sorted.length - 1])
  };
}

function countMissing(rows, headers) {
  let missing = 0;
  rows.forEach(row => {
    headers.forEach(h => { if (!row[h] || row[h] === '') missing++; });
  });
  return missing;
}

function countDupes(rows) {
  const seen = new Set();
  let dupes = 0;
  rows.forEach(row => {
    const key = JSON.stringify(row);
    if (seen.has(key)) dupes++;
    else seen.add(key);
  });
  return dupes;
}

app.post('/api/analyze/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const file = req.file;
    const mimeType = file.mimetype;
    const fileName = file.originalname;

    if (mimeType === 'text/csv' || fileName.endsWith('.csv')) {
      const textContent = file.buffer.toString('utf-8');
      const parsed = parseCSV(textContent);

      if (!parsed) {
        return res.json({ success: true, analysis: { insights: 'Could not parse CSV file. Please check the format.', financials: { rows: 0, cols: 0, missing: 0, dupes: 0, quality: 0, mean: 0, median: 0, std: 0, min: 0, max: 0, profit: 0, loss: 0, expenses: 0 } } });
      }

      const { headers, rows } = parsed;
      const numericCols = getNumericValues(rows, headers);
      const missing = countMissing(rows, parsed.headers);
      const dupes = countDupes(rows);
      const quality = Math.round(100 - (missing / (rows.length * headers.length) * 100) - (dupes / rows.length * 10));

      let stats = { mean: 0, median: 0, std: 0, min: 0, max: 0 };
      let profit = 0, loss = 0, expenses = 0;

      if (numericCols.length > 0) {
        const mainCol = numericCols[0];
        stats = calcStats(mainCol.values);
      }

      const profitCol = numericCols.find(c => c.name.toLowerCase().includes('profit'));
      const lossCol = numericCols.find(c => c.name.toLowerCase().includes('loss'));
      const expCol = numericCols.find(c => c.name.toLowerCase().includes('expense'));
      const revCol = numericCols.find(c => c.name.toLowerCase().includes('revenue'));

      if (profitCol) profit = profitCol.values.reduce((a, b) => a + b, 0);
      if (lossCol) loss = lossCol.values.reduce((a, b) => a + b, 0);
      if (expCol) expenses = expCol.values.reduce((a, b) => a + b, 0);

      const totalRevenue = revCol ? revCol.values.reduce((a, b) => a + b, 0) : 0;
      const avgRevenue = revCol ? Math.round(totalRevenue / revCol.values.length) : 0;

      let insights = 'Dataset contains ' + rows.length + ' records across ' + headers.length + ' columns. ';
      if (totalRevenue > 0) insights += 'Total revenue: $' + totalRevenue.toLocaleString() + ' with monthly average of $' + avgRevenue.toLocaleString() + '. ';
      if (profit > 0) insights += 'Total profit: $' + Math.round(profit).toLocaleString() + '. ';
      if (loss > 0) insights += 'Total loss: $' + Math.round(loss).toLocaleString() + ' — investigate loss periods. ';
      if (expenses > 0) insights += 'Total expenses: $' + Math.round(expenses).toLocaleString() + '. ';
      if (missing > 0) insights += missing + ' missing values detected. ';
      if (dupes > 0) insights += dupes + ' duplicate rows found. ';
      insights += 'Data quality score: ' + quality + '%.';

      return res.json({
        success: true,
        analysis: {
          insights,
          financials: {
            rows: rows.length,
            cols: headers.length,
            missing,
            dupes,
            quality: Math.max(0, Math.min(100, quality)),
            mean: stats.mean,
            median: stats.median,
            std: stats.std,
            min: stats.min,
            max: stats.max,
            profit: Math.round(profit),
            loss: Math.round(loss),
            expenses: Math.round(expenses)
          }
        }
      });

    } else {
      return res.json({
        success: true,
        analysis: {
          insights: 'File received: ' + fileName + '. CSV files provide the most detailed analysis. Please upload a CSV for full statistical breakdown.',
          financials: { rows: 0, cols: 0, missing: 0, dupes: 0, quality: 85, mean: 0, median: 0, std: 0, min: 0, max: 0, profit: 0, loss: 0, expenses: 0 }
        }
      });
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
    return res.json({ success: true, answer: 'You asked: "' + question + '". Connect the Anthropic API to get real AI-powered answers about your data.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, function() {
  console.log('StatLens Pro running on port ' + PORT);
});
