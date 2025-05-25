// index.js
const chromium = require('chrome-aws-lambda');
const Parser   = require('@postlight/parser');

module.exports = async (req, res) => {
  // Only support GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res
      .status(405)
      .json({ error: true, message: 'Method Not Allowed' });
  }

  // Validate URL parameter
  const rawUrl = req.query.url;
  if (!rawUrl) {
    return res
      .status(400)
      .json({ error: true, message: 'Missing ?url= parameter' });
  }
  const url = decodeURIComponent(rawUrl);

  let browser;
  try {
    // Launch headless Chromium
    browser = await chromium.puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    // Emulate a real browser
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/122.0.0.0 Safari/537.36'
    );

    // Navigate and wait until network is idle
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // 1. Try to pull the <script type="application/ld+json"> blob
    const jsonLd = await page.evaluate(() => {
      const el = document.querySelector('script[type="application/ld+json"]');
      if (!el) return null;
      try {
        return JSON.parse(el.textContent);
      } catch {
        return null;
      }
    });

    let html;
    if (jsonLd && jsonLd.articleBody) {
      // 2. articleBody is plain text with double‐newlines between paragraphs
      html = jsonLd.articleBody
        .split('\n\n')
        .map(p => `<p>${p}</p>`)
        .join('');
    } else {
      // Fallback: use the full rendered DOM
      html = await page.content();
    }

    await browser.close();

    // 3. Parse into clean JSON with Postlight Parser
    const result = await Parser.parse(url, {
      html,
      contentType: 'text/html',
      fallback: false
    });

    return res.status(200).json(result);
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    console.error('Renderer or Parser error:', err);
    return res
      .status(500)
      .json({
        error: true,
        message: err.message || 'Failed to fetch & parse',
        failed: true
      });
  }
};
