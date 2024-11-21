const jwt = require('jsonwebtoken');
const db = require('../services/db'); 
const { generateUsername } = require('../utils/validation');

exports.QueryUserData = async (req, res) => {
  const { code, derivId, token, currency } = req.body;
  const balance = 0.00;
  const email = '';
  const phoneNumber = '';
  const username = generateUsername(code);

  try {
    let user = await db.user.findFirst({
      where: { userId: code, appId: derivId }
    });

    if (user) {
      return res.status(200).json({ success: true, message: 'User connected successfully', auth_token: user.auth_token });
    } else {
      const auth_token = jwt.sign({ userId: code, appId: derivId, token }, process.env.JWT_SECRET);

      user = await db.user.create({
        data: {
          userId: code,
          balance,
          phoneNumber,
          email,
          username,
          appId: derivId,
          token,
          currency,
          auth_token
        }
      });

      return res.status(201).json({ success: true, message: 'User connected successfully', auth_token });
    }
  } catch (error) {
    console.error('Error connecting user:', error);
    return res.status(200).json({ success: false, message: 'Failed to connect user' });
  }
};
