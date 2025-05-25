// index.js
const fs         = require('fs');
const path       = require('path');
const chromium   = require('chrome-aws-lambda');
const Parser     = require('@postlight/parser');

// 1. Load bypass scripts at startup
const purifyScript = fs.readFileSync(
  path.join(__dirname, 'bypass', 'purify.min.js'),
  'utf8'
);
const bypassScript = fs.readFileSync(
  path.join(__dirname, 'bypass', 'bypass.js'),
  'utf8'
);
const injectedScript = purifyScript + '\n' + bypassScript;

// Patterns to block NYT paywall JS bundles
const paywallPatterns = [
  /meteredBundle/,
  /\/main\.[^.]+\.js$/,
  /postQuotaMeter/,
  /watchNext/
];

module.exports = async (req, res) => {
  // 2. Only allow GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res
      .status(405)
      .json({ error: true, message: 'Method Not Allowed' });
  }

  // 3. Validate ?url= param
  const rawUrl = req.query.url;
  if (!rawUrl) {
    return res
      .status(400)
      .json({ error: true, message: 'Missing ?url= parameter' });
  }
  const url = decodeURIComponent(rawUrl);

  let browser;
  try {
    // 4. Launch headless Chromium
    browser = await chromium.puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });
    const page = await browser.newPage();

    // 5. Block paywall scripts
    await page.setRequestInterception(true);
    page.on('request', request => {
      const reqUrl = request.url();
      if (paywallPatterns.some(rx => rx.test(reqUrl))) {
        return request.abort();
      }
      request.continue();
    });

    // 6. Inject DOMPurify + bypass-paywalls logic
    await page.evaluateOnNewDocument(injectedScript);

    // 7. Emulate a real browser
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/122.0.0.0 Safari/537.36'
    );

    // 8. Navigate and wait for network idle
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // 9. Try extracting JSON-LD articleBody
    const jsonLd = await page.evaluate(() => {
      const el = document.querySelector('script[type="application/ld+json"]');
      if (!el) return null;
      try { return JSON.parse(el.textContent); }
      catch { return null; }
    });

    let html;
    if (jsonLd && jsonLd.articleBody) {
      // wrap each paragraph in <p>
      html = jsonLd.articleBody
        .split('\n\n')
        .map(p => `<p>${p}</p>`)
        .join('');
    } else {
      // fallback to fully rendered DOM (with paywalls stripped)
      html = await page.content();
    }

    await browser.close();

    // 10. Parse with Postlight Parser
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
    console.error('Error in renderer/parser:', err);
    return res
      .status(500)
      .json({
        error: true,
        message: err.message || 'Failed to fetch & parse',
        failed: true
      });
  }
};
