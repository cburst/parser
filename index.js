// index.js
const fs         = require('fs');
const path       = require('path');
const chromium   = require('chrome-aws-lambda');
const Parser     = require('@postlight/parser');

// 1) Load bypass scripts once
const purifyScript = fs.readFileSync(
  path.join(__dirname, 'bypass', 'purify.min.js'),
  'utf8'
);
const bypassScript = fs.readFileSync(
  path.join(__dirname, 'bypass', 'bypass.js'),
  'utf8'
);
const injectedScript = purifyScript + '\n' + bypassScript;

// 2) Patterns for blocking paywall bundles (NYT, etc.)
const paywallPatterns = [
  /meteredBundle/,
  /\/main\.[^.]+\.js$/,
  /postQuotaMeter/,
  /watchNext/
];

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow','GET');
    return res.status(405).json({ error: true, message: 'Method Not Allowed' });
  }

  const rawUrl = req.query.url;
  if (!rawUrl) {
    return res.status(400).json({ error: true, message: 'Missing ?url= parameter' });
  }
  const url = decodeURIComponent(rawUrl);

  let browser;
  try {
    browser = await chromium.puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless
    });
    const page = await browser.newPage();

    // 3) Intercept & block known paywall scripts
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (paywallPatterns.some(rx => rx.test(u))) return r.abort();
      r.continue();
    });

    // 4) Inject the extension’s bypass + DOMPurify BEFORE any page scripts
    await page.evaluateOnNewDocument(injectedScript);

    // 5) Fake a real browser UA
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/122.0.0.0 Safari/537.36'
    );

    // 6) Navigate & wait for quiet
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // 7) Try JSON-LD extraction
    const jsonLd = await page.evaluate(() => {
      const s = document.querySelector('script[type="application/ld+json"]');
      if (!s) return null;
      try { return JSON.parse(s.textContent); }
      catch { return null; }
    });

    let html;
    if (jsonLd && jsonLd.articleBody) {
      // 8a) Full text from JSON-LD
      html = jsonLd.articleBody
        .split('\n\n')
        .map(p => `<p>${p}</p>`)
        .join('');
    } else {
      // 8b) Fallback to DOM — but strip <link rel="canonical"> so Parser won’t re-follow
      let dom = await page.content();
      html = dom.replace(
        /<link[^>]+rel=(?:'|")canonical(?:'|")[^>]*>/gi,
        ''
      );
    }

    await browser.close();

    // 9) Parse & return
    const result = await Parser.parse(url, {
      html,
      contentType: 'text/html',
      fallback: false
    });

    return res.status(200).json(result);
  } catch(err) {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    console.error('Fetch/Parse error:', err);
    return res
      .status(500)
      .json({ error: true, message: err.message || 'Failed to fetch & parse', failed: true });
  }
};
