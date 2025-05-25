const express = require('express');
const Mercury = require('./dist/mercury');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/parser', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('Missing ?url= parameter');
  }

  try {
    const result = await Mercury.parse(url, {
      contentType: 'text/html',
      fallback: true,
      headers: {
        // This is the key part
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    res.json(result);
  } catch (err) {
    console.error('Parse error:', err.message || err);
    res.status(500).json({
      error: true,
      message: err.message || 'Failed to parse article',
      failed: true
    });
  }
});

app.listen(PORT, () => {
  console.log(`Mercury Parser server listening on port ${PORT}`);
});
