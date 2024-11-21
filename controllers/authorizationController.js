const { sanitizeInput, validateParams } = require('../utils/validation');
const db = require('../services/db'); 

exports.AuthorizeApplicationCredentials = async (req, res) => {
  const { apiKey, platformId, derivId, platform } = req.body.acc;
  const referrer = req.headers.referer || '';  

  if (!apiKey || !platformId || !derivId || !platform || !referrer) {
    console.log(req.body);
    return res.status(200).json({
      success: false,
      message: `Invalid Credentials provided!`,
    });
  }

  const a = sanitizeInput(apiKey);
  const p = sanitizeInput(platformId);
  const d = sanitizeInput(derivId);
  const pl = sanitizeInput(platform);

  let domain = '';

  try {
    const url = new URL(referrer);
    domain = url.hostname;  

    console.log("Extracted domain: ", domain); 

  } catch (error) {
    console.error("Error extracting domain from referrer:", error);
    return res.status(200).json({
      success: false,
      message: 'Error extracting domain from referrer!',
    });
  }

  if (!a || !p || !d || !pl || !domain) {
    console.log(req.body);
    return res.status(200).json({ success: false, message: 'Invalid Credentials provided!' });
  }

  if (!validateParams(a, p)) {
    return res.status(200).json({ success: false, message: 'Invalid Credentials provided!' });
  }

  try {
    const appRecord = await db.app.findFirst({
      where: { apiKey: a, platformId: p, platform: pl, deriv_id: d, origin: domain },
    });

    if (!appRecord) {
      return res.status(200).json({ success: false, message: 'Invalid Credentials provided!' });
    }

    return res.status(200).json({ success: true, message: 'Credentials verified.' });
  } catch (error) {
    console.error('Error during credentials verification:', error);
    return res.status(200).json({ success: false, message: 'An error occurred!' });
  }
};

