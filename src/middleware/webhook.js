module.exports = function validateWebhook() {
    return (req, res, next) => {
        if (req.params.secret !== process.env.WEBHOOK_SECRET) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    }
};
