// index.js
const fs        = require('fs');
const path      = require('path');
const chromium  = require('chrome-aws-lambda');
const Parser    = require('@postlight/parser');

// (load your bypass scripts here, if you still want contentScript logic…)
const purifyScript = fs.readFileSync(
  path.join(__dirname, 'bypass', 'purify.min.js'),
  'utf8'
);
const bypassScript = fs.readFileSync(
  path.join(__dirname, 'bypass', 'bypass.js'),
  'utf8'
);
const injectedScript = purifyScript + '\n' + bypassScript;

module.exports = async (req, res) => {
  // … method + URL checks …

  let browser;
  try {
    browser = await chromium.puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // 1) Block NYT’s paywall script(s)
    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = req.url();
      // adjust these patterns to match the actual paywall bundles NYT loads
      if (
        url.includes('meteredBundle') ||
        url.includes('/main.')   ||  // many NYT JS bundles are named main.<hash>.js
        url.includes('watchNext') ||
        url.includes('postQuotaMeter')
      ) {
        return req.abort();
      }
      req.continue();
    });

    // 2) Inject the extension’s DOM-purify + bypass logic (optional)
    await page.evaluateOnNewDocument(injectedScript);

    // 3) Emulate a real browser
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/122.0.0.0 Safari/537.36'
    );

    // 4) Navigate and wait until network is idle
    await page.goto(decodeURIComponent(req.query.url), { waitUntil: 'networkidle0', timeout: 30000 });

    // 5) Grab the fully rendered HTML
    const html = await page.content();
    await browser.close();

    // 6) Parse & return
    const result = await Parser.parse(req.query.url, { html, contentType: 'text/html', fallback: false });
    return res.status(200).json(result);
  } catch (err) {
    if (browser) await browser.close();
    console.error(err);
    return res.status(500).json({ error: true, message: err.message });
  }
};
