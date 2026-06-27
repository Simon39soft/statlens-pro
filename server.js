const express = require('express');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 52428800 } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'StatLens Pro backend is running', hasKey: !!process.env.ANTHROPIC_API_KEY });
});

app.post('/api/analyze/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    let Anthropic;
    try {
      Anthropic = require('@anthropic-ai/sdk');
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Anthropic SDK not found: ' + e.message });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ success: false, message: 'ANTHROPIC_API_KEY is missing from environment' });
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const file = req.file;
    const mimeType = file.mimetype;
    const fileName = file.originalname;
    let messageContent = [];

    if (mimeType === 'text/csv' || fileName.endsWith('.csv')) {
      const textContent = file.buffer.toString('utf-8');
      messageContent = [{ type: 'text', text: 'Analyze this CSV and return ONLY valid JSON no markdown: {"insights":"analysis here","financials":{"rows":0,"cols":0,"missing":0,"dupes":0,"quality":0,"mean":0,"median":0,"std":0,"min":0,"max":0,"profit":0,"loss":0,"expenses":0}}\n\nCSV DATA:\n' + textContent.substring(0, 4000) }];
    } else if (mimeType.includes('image')) {
      const fileContent = file.buffer.toString('base64');
      messageContent = [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: fileContent } },
        { type: 'text', text: 'Analyze this image and return ONLY valid JSON no markdown: {"insights":"analysis here","financials":{"rows":0,"cols":0,"missing":0,"dupes":0,"quality":85,"mean":0,"median":0,"std":0,"min":0,"max":0,"profit":0,"loss":0,"expenses":0}}' }
      ];
    } else {
      const textContent = file.buffer.toString('utf-8');
      messageContent = [{ type: 'text', text: 'Analyze this data and return ONLY valid JSON no markdown: {"insights":"analysis here","financials":{"rows":0,"cols":0,"missing":0,"dupes":0,"quality":0,"mean":0,"median":0,"std":0,"min":0,"max":0,"profit":0,"loss":0,"expenses":0}}\n\nDATA:\n' + textContent.substring(0, 4000) }];
    }

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
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
    return res.status(500).json({ success: false, message: err.message || 'Analysis failed' });
  }
});

app.post('/api/ask', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ success: false, message: 'No question provided' });
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: 'Answer this data question clearly: ' + question }]
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
