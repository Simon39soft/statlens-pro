const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'StatLens Pro backend is running'
  });
});

app.post('/api/analyze/upload', (req, res) => {
  res.json({
    success: true,
    analysis: {
      insights: 'Backend connected successfully',
      financials: {
        profit: 100000,
        loss: 0,
        expenses: 0
      }
    }
  });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Running on port ${PORT}`);
});
