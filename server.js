const express = require('express')
const cors = require('cors')
require('dotenv').config()

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: '✅ StatLens Pro Backend Running' })
})

app.post('/api/analyze/upload', (req, res) => {
  res.json({
    success: true,
    analysis: { insights: '✅ Backend connected!' },
    financials: { profit: 100000, loss: 0, expense: 50000 }
  })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`✅ Running on ${PORT}`))
