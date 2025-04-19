const express = require('express');
const router = express.Router();
const { AuthorizeApplicationCredentials } = require('../controllers/authorizationController');
const { QueryUserData } = require('../controllers/userController');

router.post('/authorize', AuthorizeApplicationCredentials);
router.post('/query-user', QueryUserData);

module.exports = router;
