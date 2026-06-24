const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'StatLens Pro backend is running' });
});

app.post('/api/analyze/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const file = req.file;
    const mimeType = file.mimetype;
    const fileName = file.originalname;
    let messageContent = [];

    if (mimeType === 'text/csv' || fileName.endsWith('.csv')) {
      const textContent = file.buffer.toString('utf-8');
      const prompt = 'You are a senior data analyst. Analyze this CSV data and return ONLY a valid JSON object with no extra text, no markdown, no backticks:\n\n' + textContent.substring(0, 8000) + '\n\nReturn exactly this structure:\n{"insights":"write your analysis here","financials":{"rows":0,"cols":0,"missing":0,"dupes":0,"quality":0,"mean":0,"median":0,"std":0,"min":0,"max":0,"profit":0,"loss":0,"expenses":0}}';
      messageContent = [{ type: 'text', text: prompt }];
    } else if (mimeType.includes('image')) {
      const fileContent = file.buffer.toString('base64');
      messageContent = [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: fileContent } },
        { type: 'text', text: 'You are a senior data analyst. Analyze this image and extract any data visible. Return ONLY a valid JSON object with no extra text, no markdown, no backticks:\n{"insights":"write your analysis here","financials":{"rows":0,"cols":0,"missing":0,"dupes":0,"quality":85,"mean":0,"median":0,"std":0,"min":0,"max":0,"profit":0,"loss":0,"expenses":0}}' }
      ];
    } else if (mimeType === 'application/pdf') {
      const fileContent = file.buffer.toString('base64');
      messageContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileContent } },
        { type: 'text', text: 'You are a senior data analyst. Analyze this PDF and extract any financial data. Return ONLY a valid JSON object with no extra text, no markdown, no backticks:\n{"insights":"write your analysis here","financials":{"rows":0,"cols":0,"missing":0,"dupes":0,"quality":85,"mean":0,"median":0,"std":0,"min":0,"max":0,"profit":0,"loss":0,"expenses":0}}' }
      ];
    } else {
      const textContent = file.buffer.toString('utf-8');
      const prompt = 'You are a senior data analyst. Analyze this file called ' + fileName + ' and return ONLY a valid JSON object with no extra text, no markdown, no backticks:\n\n' + textContent.substring(0, 8000) + '\n\nReturn exactly this structure:\n{"insights":"write your analysis here","financials":{"rows":0,"cols":0,"missing":0,"dupes":0,"quality":0,"mean":0,"median":0,"std":0,"min":0,"max":0,"profit":0,"loss":0,"expenses":0}}';
      messageContent = [{ type: 'text', text: prompt }];
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: messageContent }]
    });

    const rawText = response.content[0].text.trim();
    let analysisData;

    try {
      const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      analysisData = JSON.parse(cleaned);
    } catch (e) {
      analysisData = {
        insights: rawText,
        financials: { rows: 0, cols: 0, missing: 0, dupes: 0, quality: 75, mean: 0, median: 0, std: 0, min: 0, max: 0, profit: 0, loss: 0, expenses: 0 }
      };
    }

    return res.json({ success: true, analysis: analysisData });

  } catch (err) {
    console.error('Analysis error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Analysis failed' });
  }
});

app.post('/api/ask', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ success: false, message: 'No question provided' });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: 'You are a data analyst. Answer this question clearly and concisely: ' + question }]
    });

    return res.json({ success: true, answer: response.content[0].text });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, function() {
  console.log('StatLens Pro running on port ' + PORT);
});
