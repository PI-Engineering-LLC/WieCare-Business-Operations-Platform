function sanitizeUser(user) {
    const { 
        password_hash, 
        mfa_secret_encrypted, 
        invite_token, 
        invite_expires_at,
        google_id,      // internal — don't expose
        ...safe 
    } = user;
    return safe;
}

module.exports = sanitizeUser;