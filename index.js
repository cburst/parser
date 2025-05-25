const express = require('express');
const Mercury = require('./dist/mercury');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/parser', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing ?url= parameter');
  try {
    const result = await Mercury.parse(url);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error parsing URL');
  }
});

app.listen(PORT, () => {
  console.log(`Mercury Parser running on port ${PORT}`);
});