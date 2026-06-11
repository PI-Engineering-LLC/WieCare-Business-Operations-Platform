const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const token = req.cookies?.access_token || req.headers.authorization?.split(' ')[1];
    if (!token)
      return res.status(401).json({ error: 'Unauthorized - No token' });
  
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.mfa_pending) {
        return res.status(403).json({ error: 'Multi-Factor Authentication required' });
      }
      req.auth = decoded;
      next();
    } catch(err) {
      console.error("JWT Verification Error:", err.message);
      res.status(401).json({ error: 'Unauthorized - Invalid or expired token' });
    }
};