// index.js
const Parser = require('@postlight/parser');

module.exports = async (req, res) => {
  // Only support GET /parser?url=…
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res
      .status(405)
      .json({ error: true, message: 'Method Not Allowed' });
  }

  const rawUrl = req.query.url;
  if (!rawUrl) {
    return res
      .status(400)
      .json({ error: true, message: 'Missing ?url= parameter' });
  }

  try {
    const result = await Parser.parse(decodeURIComponent(rawUrl), {
      contentType: 'text/html',
      fallback: true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    res.status(200).json(result);
  } catch (err) {
    console.error('Parse error:', err);
    res
      .status(500)
      .json({
        error: true,
        message: err.message || 'Failed to parse article',
        failed: true,
      });
  }
};
