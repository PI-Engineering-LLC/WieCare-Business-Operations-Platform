const router = require('express').Router();
const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const qrCode = require('qrcode');
const emailService = require('../services/email.service'); 
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const resolveClientContext = require('../middleware/resolveClientContext');
const asyncHandler = require('../middleware/asyncHandler');
const sanitizeUser = require('../utils/sanitizeUser');
const { encrypt, decrypt } = require('../utils/encryption');
const {
  issueAccessToken,
  issueRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens
} = require('../utils/tokens');
const validate  = require('../middleware/validate');
const { z } = require('zod');
const passport = require('../config/passport'); 
const permissionCache = require('../lib/permissionsCache');

// ─── Validation Schemas ───
const signupSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string(),
  mfa_code: z.string().length(6).optional(),
});

router.post('/setup-mfa', requireAuth,loadContext, asyncHandler( async (req, res)=> {
    const secret = speakeasy.generateSecret({
      name: `${process.env.MFA_ISSUER} (${req.user.email})`,
        length: 20,
    });
     const encryptedSecret = encrypt(secret.base32);
    await db('users').where({ id: req.auth.userId }).update({
        mfa_secret: encryptedSecret,
        mfa_enabled: false, // Remains false until verified
    });
    const qrCodeUrl = await qrCode.toDataURL(secret.otpauth_url);
    res.json({ qrCode: qrCodeUrl});
}));

router.post('/disable-mfa', requireAuth, asyncHandler( async (req, res)=> {
  const { code } = req.body;
  const user = await db('users').where({ id: req.auth.userId, deleted_at: null  }).first();

  if (!user || !user.mfa_enabled) {
    return res.status(400).json({ error: 'MFA is not enabled or user not found' });
  }
  const secret = decrypt(user.mfa_secret);
  const verified = speakeasy.totp.verify({
   secret: secret,
   encoding: 'base32',
   token: code,
   window: 1,
 });

 if (!verified) {
  return res.status(401).json({ error: 'Invalid code' });
}
await db('users').where({ id: user.id }).update({  mfa_enabled: false, mfa_secret: null });
  res.json({  message: 'MFA disabled' });
}));

router.post('/verify-mfa', asyncHandler( async (req, res)=> {
  const token = req.cookies?.access_token
  const {  code } = req.body;
    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const user = await db('users').where({ id: payload.userId, deleted_at: null }).first();
    if (!user || !user.mfa_secret) return res.status(400).json({ error: 'MFA not set up or user not found' });

    const rawSecret = decrypt(user.mfa_secret);
    const verified = speakeasy.totp.verify({
      secret: rawSecret,
      encoding: 'base32',
      token: code,
    window: 1,
    });

    if (!verified) {
      return res.status(401).json({ error: 'Invalid code' });
    }
  const backupCodes = Array.from({ length: 10 }, () =>
    crypto.randomBytes(4).toString('hex')
  );
  const hashedCodes = backupCodes.map(c => bcrypt.hashSync(c, 10));
  const firstEnable = user.mfa_enabled;

    if (!user.mfa_enabled) {
        await db('users').where({ id: user.id }).update({ mfa_enabled: true, mfa_backup_codes: JSON.stringify(hashedCodes) });
    }
    const accessToken = issueAccessToken(user);
    res.cookie("access_token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: "none",
      maxAge: 15 * 60 * 1000, // 15 minutes
    });
    if(firstEnable){
      res.json({ message: 'MFA enabled successfully. Save backup codes!', backup_codes: backupCodes, mfa_enabled: firstEnable });
    }else{
      res.json({ message: 'MFA enabled successfully.', mfa_enabled: firstEnable });

    }

}));

router.post('/login', validate(loginSchema),  asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await db('users').where({ email: email.toLowerCase(), deleted_at: null }).first();
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  if (!user.password_hash && user.status === 'active') {
    return res.status(400).json({ error: 'Please sign in with Google' });
  }
  const valid = await bcrypt.compare(password, user.password_hash); 
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  if (!user.is_verified)
    return res.status(403).json({ error: 'Account not set up — check your invite email' });
  if (user.status !== 'active')
    return res.status(403).json({ error: 'Account deactivated' });

  if (user.force_password_reset) {
    return res.json({ requiresPasswordReset: true });
  }

  if (user.mfa_enabled) {
    const partialToken = jwt.sign(
        { userId: user.id, mfa_pending: true },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
    );
    res.cookie("access_token", partialToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: "none",
      maxAge: 5 * 60 * 1000, // 5 minutes
    });
    return res.json({ mfa_required: true });  
  }

  const accessToken = issueAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id);

   res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: "none",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.cookie("access_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: "none",
    maxAge: 15 * 60 * 1000, // 15 minutes
  });
  res.json({ success: true});
}));

router.post('/refresh', asyncHandler( async (req, res) => {
  const token = req.cookies.refresh_token;
  if (!token) return res.status(401).json({ error: 'No refresh token' });

  const stored = await db('refresh_tokens')
      .where({ token })
      .where('expires_at', '>', new Date())
      .first();

  if (!stored) return res.status(401).json({ error: 'Invalid or expired refresh token' });

  const user = await db('users').where({ id: stored.user_id, deleted_at: null  }).first(); 
  if (!user) return res.status(401).json({ error: 'User associated with refresh token not found or revoked' });

  await revokeRefreshToken(token);
  const newRefreshToken = await issueRefreshToken(user.id);
  const newAccessToken = issueAccessToken(user);

  res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.cookie("access_token", newAccessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: "none",
    maxAge: 15 * 60 * 1000, // 15 minutes
  });
    res.json({ success: true })
}));


// POST /api/auth/accept-invite
router.post('/accept-invite', validate(signupSchema), asyncHandler( async (req, res) => {
  const { token, password } = req.body;
  const [selector, verifier] = token.split('.');

  const matchedInvite = await db('invites').where({ token_selector: selector }).first();

  if (!matchedInvite || new Date() > new Date(matchedInvite.invite_expires_at))
    return res.status(400).json({ error: 'Invalid or expired invite link' });

  const valid = await bcrypt.compare(verifier, matchedInvite.invite_token); 
  if (!valid) {
    return res.status(400).json({error: 'Invalid invite'});
  }

  let user = await db('users').where({ email: matchedInvite.email, deleted_at: null  }).first();

  if(!user){
    const password_hash = await bcrypt.hash(password, 12);
    [user] = await db('users').insert({
      email: matchedInvite.email,
      platform_role: matchedInvite.platform_role,
      password_hash,
      status: 'active',
      is_verified: true,
      // Add full_name if available from invite or default
      full_name: matchedInvite.email.split('@')[0] // Basic default
    }).returning('*');
  } else {
    // If user exists, update their platform role if it's different and from a platform invite
    if (matchedInvite.platform_role && user.platform_role !== matchedInvite.platform_role) {
        await db('users').where({ id: user.id }).update({
            platform_role: matchedInvite.platform_role,
            is_verified: true, // Mark as verified upon invite acceptance
            status: 'active',
            updated_at: new Date()
        });
    }
    // If password was null, set it
    if (!user.password_hash) {
        const password_hash = await bcrypt.hash(password, 12);
        await db('users').where({ id: user.id }).update({
            password_hash,
            updated_at: new Date()
        });
    }
  }
  
  // Client memberships for client invitations
  if (matchedInvite.client_id && user) { // Ensure user is available and client_id in invite
    const [membership] = await db('client_memberships').insert({
      client_id: matchedInvite.client_id,
      user_id: user.id,
      is_active: true, // Ensure membership is active
      created_at: new Date(),
      updated_at: new Date()
    }).onConflict(['user_id', 'client_id']).merge({ is_active: true, updated_at: new Date() }).returning('*');
    // Assign roles from invite using the new membership_roles table
    if (matchedInvite.role_ids && Array.isArray(matchedInvite.role_ids) && membership) {
      // Clear existing roles for this membership first to ensure a clean update
      await db('membership_roles').where({ membership_id: membership.id }).delete();

      const roleInserts = matchedInvite.role_ids.map(role_id => ({
        membership_id: membership.id,
        role_id,
      }));
      await db('membership_roles').insert(roleInserts).onConflict().ignore();
    }
  }

  await db('invites').where({id: matchedInvite.id}).update({accepted_at: new Date()});

  // --- Cache Invalidation ---
  if (user) {
    permissionCache.del(`user_client_permissions:${user.id}`);
    console.log(`Invalidated permission cache for user ${user.id} due to invite acceptance.`);
  }

  res.json({ success: true, nextStep: "login", requireLogin: "true",message: 'Account activated. Please log in.'  });
}));

router.post('/change-password', requireAuth, asyncHandler( async (req, res) => {
  const { current_password, new_password } = req.body;
  const user = await db('users').where({ id: req.auth.userId, deleted_at: null }).first();
  if (!user || !(await bcrypt.compare(current_password, user.password_hash))) 
    return res.status(400).json({ error: 'Current password is incorrect' });
  const password_hash = await bcrypt.hash(new_password, 12);
  await db('users').where({ id: user.id }).update({ password_hash, force_password_reset: false, updated_at: new Date() });
  res.json({ success: true });
}));

router.post('/reset-password', asyncHandler( async (req, res) => {
    const { token, password } = req.body;
    const [selector, verifier] = token.split('.');

    const reset = await db('password_resets').where({ token_selector: selector }).first();
    if (!reset || new Date() > new Date(reset.reset_expires_at) || reset.used_at !== null) 
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    const valid = await bcrypt.compare(verifier, reset.reset_token); 
    if (!valid) {
      return res.status(400).json({error: 'Invalid reset'});
    }

    const password_hash = await bcrypt.hash(password, 12);
    await db('users').where({ id: reset.user_id }).update({password_hash, force_password_reset: false, updated_at: new Date()});

    await db('password_resets').where({ id: reset.id }).update({used_at: new Date(), updated_at: new Date()});
    res.json({ success: true });
}));

router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await db('users').where({ email: email.toLowerCase(), deleted_at: null  }).first();

  if (!user) return res.json({ message: 'If that email is registered, a reset link has been sent.' });
  const selector = crypto.randomBytes(8).toString('hex');
  const verifier = crypto.randomBytes(32).toString('hex');
  const token = `${selector}.${verifier}`;
  const tokenHash = await bcrypt.hash(verifier, 10); 
  const expires = Date.now() + 1000 * 60 * 60; // 1 hour

  await db('password_resets').insert({
    user_id: user.id,
    token_selector: selector,
    reset_token: tokenHash,
    reset_expires_at: new Date(expires),
  });
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`;
  const fullName = user.full_name;

  await emailService.queue({ type: 'reset', to: user.email, payload: {
    fullName,
    resetUrl
  } });
  res.json({ message: 'If that email is registered, a reset link has been sent.' });
}));


router.post('/logout',requireAuth,loadContext,resolveClientContext, asyncHandler(async (req, res) => {
    const token = req.cookies.refresh_token;
    if (token) await revokeRefreshToken(token);

    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none',
    });
    res.clearCookie('access_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none',
    });
    res.json({ message: 'Logged out' });
  }));

router.post('/logout-all', requireAuth, asyncHandler( async (req, res) => {
  await revokeAllUserTokens(req.user.id);
  res.clearCookie('refresh_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
  });
  res.clearCookie('access_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
  });
  res.json({ message: 'Logged out from all devices' });
}));

// Google OAuth routes
router.get('/google', (req, res, next) => {
    const state = req.query.invite_token
        ? Buffer.from(req.query.invite_token).toString('base64')
        : undefined;

    passport.authenticate('google', {
        scope: ['email', 'profile'],
        session: false,
        state,
    })(req, res, next);
});

router.get('/google/callback',
  passport.authenticate('google', {
    session: false,
    failWithError: true,
}),
    async (req, res) => {
        const user = req.user;
        
        // If user is coming from an invite token through Google OAuth
        if (req.query.state) {
            const inviteToken = Buffer.from(req.query.state, 'base64').toString('utf8');
            const [selector, verifier] = inviteToken.split('.');

            const matchedInvite = await db('invites').where({ token_selector: selector }).first();

            if (matchedInvite && new Date() < new Date(matchedInvite.invite_expires_at)) {
                const validInviteVerifier = await bcrypt.compare(verifier, matchedInvite.invite_token);
                if (validInviteVerifier && matchedInvite.email.toLowerCase() === user.email.toLowerCase()) {
                    // This user has accepted an invite via Google. Process membership and roles.
                    if (matchedInvite.client_id) {
                        const [membership] = await db('client_memberships').insert({
                            client_id: matchedInvite.client_id,
                            user_id: user.id,
                            is_active: true,
                        }).onConflict(['user_id', 'client_id']).merge({ is_active: true, updated_at: new Date() }).returning('*');

                        if (matchedInvite.role_ids && Array.isArray(matchedInvite.role_ids) && membership) {
                            await db('membership_roles').where({ membership_id: membership.id }).delete();
                            const roleInserts = matchedInvite.role_ids.map(role_id => ({ membership_id: membership.id, role_id }));
                            await db('membership_roles').insert(roleInserts).onConflict().ignore();
                        }
                    }
                    // Update platform role if invite had one
                    if (matchedInvite.platform_role && user.platform_role !== matchedInvite.platform_role) {
                        await db('users').where({ id: user.id }).update({
                            platform_role: matchedInvite.platform_role,
                            is_verified: true,
                            status: 'active',
                            updated_at: new Date()
                        });
                    }
                    await db('invites').where({ id: matchedInvite.id }).update({ accepted_at: new Date() });

                    // --- Cache Invalidation after Google OAuth invite acceptance ---
                    permissionCache.del(`user_client_permissions:${user.id}`);
                    console.log(`Invalidated permission cache for user ${user.id} due to Google OAuth invite acceptance.`);
                }
            }
        }

        if (user.mfa_enabled) {
            const partialToken = jwt.sign(
                { userId: user.id, mfa_pending: true },
                process.env.JWT_SECRET,
                { expiresIn: '10m' }
            );
            res.cookie("access_token", partialToken, {
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: "none",
              maxAge: 5 * 60 * 1000, // 5 minutes
            });
            return res.redirect(
              `${process.env.FRONTEND_URL}/mfa-verify`
          );
            
        }

        const token = issueAccessToken(user, process.env.JWT_EXPIRES_IN);
        const refreshToken = await issueRefreshToken(user.id);

        res.cookie('refresh_token', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });
        res.cookie("access_token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: "none",
          maxAge: 15 * 60 * 1000, // 15 minutes
        });
        res.redirect(`${process.env.FRONTEND_URL}/auth-callback`);
    },
    (err, req, res, next) => {
        console.error("Google OAuth Callback Error:", err);
        res.redirect(`${process.env.FRONTEND_URL}/login?error=not_invited`);
    }
);

module.exports = router;
