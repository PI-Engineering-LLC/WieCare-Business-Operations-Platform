const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
//TODO
function issueAccessToken(user, valid_for = '15m') {
    return jwt.sign(
        { userId: user.id},
        // { id: user.id, email: user.email, role: user.role, client_role: user.client_role, client_id: user.client_id },
        process.env.JWT_SECRET,
        { expiresIn: valid_for } // short-lived
    );
}

async function issueRefreshToken(userId) {
    const token = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db('refresh_tokens').insert({
        user_id: userId,
        token,
        expires_at: expiresAt,
    });

    return token;
}

async function revokeRefreshToken(token) {
    await db('refresh_tokens').where({ token }).delete();
}

async function revokeAllUserTokens(userId) {
    await db('refresh_tokens').where({ user_id: userId }).delete();
}

module.exports = { issueAccessToken, issueRefreshToken, revokeRefreshToken, revokeAllUserTokens };
