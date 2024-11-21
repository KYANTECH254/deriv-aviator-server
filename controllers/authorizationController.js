const { sanitizeInput, validateParams } = require('../utils/validation');
const db = require('../services/db'); 

exports.AuthorizeApplicationCredentials = async (req, res) => {
  const { apiKey, platformId, derivId, platform } = req.body.acc;
  const referrer = req.headers.referer || '';  

  if (!apiKey || !platformId || !derivId || !platform || !referrer) {
    console.log(req.body);
    return res.status(200).json({
      success: false,
      message: 'Invalid Credentials provided!',
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
      message: 'Invalid Credentials provided!',
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
      where: { apiKey: a, platformId: p, platform: pl },
    });

    if (!appRecord) {
      return res.status(200).json({ success: false, message: 'Invalid Credentials provided!' });
    }

    const dbOrigins = appRecord.origin.split(',');
    if (dbOrigins.length === 1) {
      if (dbOrigins[0] !== domain) {
        return res.status(200).json({ success: false, message: 'Invalid Credentials provided!' });
      }
    } else {
      const isValidDomain = dbOrigins.some((dbDomain) => dbDomain.trim() === domain);
      if (!isValidDomain) {
        return res.status(200).json({ success: false, message: 'Invalid Credentials provided!' });
      }
    }

    const dbDerivIds = appRecord.deriv_id.split(',');
    if (dbDerivIds.length === 1) {
      if (dbDerivIds[0] !== d) {
        return res.status(200).json({ success: false, message: 'Invalid Credentials provided!' });
      }
    } else {
      const isValidDerivId = dbDerivIds.some((dbDerivId) => dbDerivId.trim() === d);
      if (!isValidDerivId) {
        return res.status(200).json({ success: false, message: 'Invalid Credentials provided!' });
      }
    }

    return res.status(200).json({ success: true, message: 'Credentials verified.' });
  } catch (error) {
    console.error('Error during credentials verification:', error);
    return res.status(200).json({ success: false, message: 'An error occurred!' });
  }
};


