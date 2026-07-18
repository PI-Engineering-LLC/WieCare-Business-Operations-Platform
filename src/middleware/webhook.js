// middleware/webhookAuth.js
const validateWebhook = (req, res, next) => {
    if (req.query.secret !== process.env.WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};