// index.js
const fs        = require('fs');
const path      = require('path');
const chromium  = require('chrome-aws-lambda');
const Parser    = require('@postlight/parser');

// 1) Load bypass-paywalls scripts once
const purifyScript = fs.readFileSync(
  path.join(__dirname, 'bypass', 'purify.min.js'),
  'utf8'
);
const bypassScript = fs.readFileSync(
  path.join(__dirname, 'bypass', 'bypass.js'),
  'utf8'
);
const injectedScript = purifyScript + '\n' + bypassScript;

// 2) Which request URLs to kill (NYT, etc.)
const paywallPatterns = [
  /meteredBundle/,
  /\/main\.[^.]+\.js$/,
  /postQuotaMeter/,
  /watchNext/
];

// 3) JSON-LD must have at least this many paragraphs to count
const MIN_JSON_PARAS = 10;

module.exports = async (req, res) => {
  // Only GET /parser
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res
      .status(405)
      .json({ error: true, message: 'Method Not Allowed' });
  }

  // Must have ?url=
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
      headless: chromium.headless
    });
    const page = await browser.newPage();

    // 4) Intercept & block paywall scripts
    await page.setRequestInterception(true);
    page.on('request', request => {
      const u = request.url();
      if (paywallPatterns.some(rx => rx.test(u))) {
        return request.abort();
      }
      request.continue();
    });

    // 5) Inject bypass + DOMPurify before any site JS
    await page.evaluateOnNewDocument(injectedScript);

    // 6) Emulate a real browser UA
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/122.0.0.0 Safari/537.36'
    );

    // 7) Navigate and wait until network is idle
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // 8) Grab full DOM and strip any <link rel="canonical">
    let dom = await page.content();
    const cleanedDom = dom.replace(
      /<link[^>]+rel=(?:'|")canonical(?:'|")[^>]*>/gi,
      ''
    );

    // 9) Try extracting full text from JSON-LD
    const jsonLd = await page.evaluate(() => {
      const s = document.querySelector('script[type="application/ld+json"]');
      if (!s) return null;
      try { return JSON.parse(s.textContent); }
      catch { return null; }
    });

    let html;
    if (
      jsonLd &&
      Array.isArray(jsonLd.articleBody?.split) &&
      jsonLd.articleBody.split('\n\n').length >= MIN_JSON_PARAS
    ) {
      // 10a) Use JSON-LD if it’s “long enough”
      html = jsonLd.articleBody
        .split('\n\n')
        .map(p => `<p>${p}</p>`)
        .join('');
    } else {
      // 10b) Otherwise fallback to the injected & cleaned DOM
      html = cleanedDom;
    }

    await browser.close();

    // 11) Parse into clean JSON
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
    console.error('Fetch/Parse error:', err);
    return res
      .status(500)
      .json({ error: true, message: err.message || 'Failed to fetch & parse', failed: true });
  }
};
