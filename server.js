sis error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Analysis failed' });
  }
});

// BACKEND CONNECTION POINT: Ask your data endpoint
app.post('/api/ask', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ success: false, message: 'No question provided' });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: `You are a data analyst assistant. Answer this question about data analysis clearly and concisely: ${question}` }]
    });

    return res.json({ success: true, answer: response.content[0].text });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => { console.log(`StatLens Pro running on port ${PORT}`); });
