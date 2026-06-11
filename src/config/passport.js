const passport      = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const JwtStrategy   = require('passport-jwt').Strategy;
const ExtractJwt    = require('passport-jwt').ExtractJwt;
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const bcrypt        = require('bcrypt');
const db            = require('../db');

// ── Local (email + password login) ──────────────────────────────
passport.use(new LocalStrategy(
  { usernameField: 'email', passwordField: 'password' },
  async (email, password, done) => {
    try {
      const user = await db('users').where({ email: email.toLowerCase(), deleted_at: null  }).first();
      if (!user) return done(null, false, { message: 'Invalid credentials' });
      if (!user.password_hash) return done(null, false, { message: 'Use Google sign-in' });
      if (user.status !== 'active') return done(null, false, { message: 'Account disabled' });
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return done(null, false, { message: 'Invalid credentials' });
      return done(null, user);
    } catch (e) {
      return done(e);
    }
  }
));

// ── JWT (Bearer token on protected routes) ───────────────────────
passport.use(new JwtStrategy(
  {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey:    process.env.JWT_SECRET,
  },
  async (payload, done) => {
    try {
      const user = await db('users').where({ id: payload.userId , deleted_at: null }).first();
      if (!user || !user.is_active) return done(null, false);
      return done(null, user);
    } catch (e) {
      return done(e);
    }
  }
));

//Google Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL, 
    passReqToCallback: true 
}, async (req, accessToken, refreshToken, profile, done) => {
    try {
        const email = profile.emails[0].value.toLowerCase();
        const state = req.query.state;
        const inviteToken = state ? Buffer.from(state, 'base64').toString('ascii') : null;
        let user;

        if (inviteToken) {
            const [selector, verifier] = inviteToken.split('.');
            const invitation = await db('invites').where({ token_selector: selector }).first();

            if (!invitation || new Date() > new Date(invitation.invite_expires_at)) {
                return done(null, false, { message: 'Invalid or expired invite link' });
            }
            const valid = await bcrypt.compare(verifier, invitation.invite_token);

            if (!valid) {
                return done(null, false, { message: 'Invalid invite' });
            }

            user = await db('users').where({ email, deleted_at: null }).first();
            if (!user) {
              // Create new user if not found
                [user] = await db('users').insert({
                    email,
                    status: 'active',
                    google_id: profile.id,
                    full_name: profile.displayName,
                    platform_role: invitation.platform_role, 
                    is_verified: true
                }).returning('*');
            } else {
              // Update existing user, link Google ID
                await db('users').where({ id: user.id }).update({
                    status: 'active',
                    google_id: profile.id,
                    full_name: profile.displayName,
                    platform_role: invitation.platform_role, 
                    is_verified: true
                });
            }

            // Handle client memberships and roles if invited to a client
            if (invitation?.client_id && user) { // Ensure user is created/updated
                let [membership] = await db('client_memberships').insert({
                    client_id: invitation.client_id,
                    user_id: user.id,
                    is_active: true,
                }).onConflict(['user_id', 'client_id']).ignore().returning('*'); // membership contains the new/existing client_membership record
             
                // Assign roles from invite using the new membership_roles table
                if (invitation.role_ids && Array.isArray(invitation.role_ids) && membership) {
                    const roleInserts = invitation.role_ids.map(role_id => ({
                        membership_id: membership.id,
                        role_id,
                    }));
                    await db('membership_roles').insert(roleInserts).onConflict().ignore();
                }
            }

            await db('invites').where({ id: invitation.id }).update({ accepted_at: new Date() });

        } else {
            // Regular Google sign-in (not via invite token)
            user = await db('users').where({ google_id: profile.id, deleted_at: null }).first();

            if (!user) {
                user = await db('users').where({ email, deleted_at: null }).first();
                if (user) {
                    // Link Google ID if not yet linked
                    if (!user.google_id) {
                        await db('users').where({ id: user.id }).update({
                            google_id: profile.id,
                            full_name: profile.displayName,
                        });
                    }
                } else {
                    return done(null, false, { message: 'No user with this profile was found.' });
                }
            }
        }
        return done(null, user);
    } catch (e) {
        return done(e);
    }
}));

module.exports = passport;
