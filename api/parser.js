// api/parser.js
import Parser from '@postlight/parser';

export default async function handler(req, res) {
  const { url, contentType, html } = req.query;

  if (!url) {
    res.status(400).json({ error: true, message: 'Missing `url` query parameter.' });
    return;
  }

  try {
    // Build options object dynamically
    const options = {};
    if (contentType) options.contentType = contentType;
    if (html)          options.html        = html;

    // Run the parser locally (no external API key needed)
    const data = await Parser.parse(decodeURIComponent(url), options);
    res.status(200).json(data);
  } catch (err) {
    console.error('Parser error:', err);
    res
      .status(500)
      .json({ error: true, message: err.message });
  }
}