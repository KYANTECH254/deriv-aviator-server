const { sanitizeInput, validateParams } = require('../utils/validation');
const db = require('../services/db'); // Make sure you have a db connection setup

exports.AuthorizeApplicationCredentials = async (req, res) => {
  const { apiKey, platformId, derivId, platform } = req.body.acc;
  const origin = req.body.origin;

  if (!apiKey || !platformId || !derivId || !platform || !origin) {
    console.log(req.body)
    return res.status(200).json({ success: false, message: `Invalid Credentials provided 1! ${JSON.stringify(req.body)}` });
  }

  const a = sanitizeInput(apiKey);
  const p = sanitizeInput(platformId);
  const d = sanitizeInput(derivId);
  const pl = sanitizeInput(platform);
  const o = origin;

  if (!a || !p || !d || !pl || !o) {
    console.log(req.body)
    return res.status(200).json({ success: false, message: 'Invalid Credentials provided 2!' });
  }

  if (!validateParams(a, p)) {
    return res.status(200).json({ success: false, message: 'Invalid Credentials provided 3!' });
  }

  try {
    const appRecord = await db.app.findFirst({
      where: { apiKey: a, platformId: p, platform: pl, deriv_id: d, origin: o },
    });

    if (!appRecord) {
      return res.status(200).json({ success: false, message: 'Invalid Credentials provided!' });
    }

    return res.status(200).json({ success: true, message: 'Credentials verified.' });
  } catch (error) {
    return res.status(200).json({ success: false, message: 'An error occurred!' });
  }
};
