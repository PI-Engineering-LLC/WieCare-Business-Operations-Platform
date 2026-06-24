const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../db');
const emailService = require('./email.service');

class InviteService {
    async createInvite({ email, inviteType, clientId, role_ids, platformRole, authProvider = 'any', invitedBy }) { 
        return await db.transaction(async trx => {
            const normalizedEmail = email.trim().toLowerCase();
            const existingUser = await trx('users')
                .where({ email: normalizedEmail, deleted_at: null })
                .first();

            if (existingUser) { throw new Error('User already exists'); }
            const existingInvite = await trx('invites').where({ email: normalizedEmail })
                .whereNull('accepted_at')
                .where('invite_expires_at', '>', trx.fn.now()).first();
            if (existingInvite) { throw new Error('Active invite already exists'); }

            const selector = crypto.randomBytes(8).toString('hex');
            const verifier = crypto.randomBytes(32).toString('hex');
            const invite_token = `${selector}.${verifier}`;
            const tokenHash = await bcrypt.hash(verifier, 12); 

            const invite_expires_at = new Date(Date.now() + 72 * 60 * 60 * 1000);

            const [invite] = await trx('invites')
                .insert({
                    email: normalizedEmail,
                    invite_type: inviteType,
                    client_id: clientId || null,
                    role_ids: role_ids ? JSON.stringify(role_ids) : db.raw('\'[]\'::jsonb'), // Store as JSONB array
                    platform_role: platformRole || null,
                    auth_provider: authProvider,
                    token_selector: selector,
                    invite_token: tokenHash,
                    invited_by: invitedBy,
                    invite_expires_at,
                })
                .returning('*');

                const inviter = await trx('users')
                .where({ id: invitedBy, deleted_at: null })
                .first(); 
                let inviterOrg;  
                let inviterOrgName;
                let inviterOrgCoaster;
                inviterOrg = await trx('clients')
                .where({ id: clientId })
                .first();

            const inviteUrl = `${process.env.FRONTEND_URL}/accept-invite/${invite_token}`;
            const inviterName = inviter?.full_name
            if(inviterOrg){
                inviterOrgName = inviterOrg?.company_name
                inviterOrgCoaster = inviterOrg?.coaster_name
            }
            

            await emailService.queue({ to: normalizedEmail, type: 'invite', payload: { inviteUrl, inviterName, inviterOrgName, inviterOrgCoaster, inviteType } });
            return { id: invite.id, email: normalizedEmail, inviteUrl, invite_expires_at };
        }
        );
    }

    async validateInviteToken(token) {
        if (!token || !token.includes('.')) {
            throw new Error('Invalid token');
        }
        const [selector, verifier] = token.split('.');

        const invite = await db('invites')
            .where({ token_selector: selector })
            .first(); 

        if (!invite) { throw new Error('Invite not found'); }
        if (invite.accepted_at) { throw new Error('Invite already accepted'); }

        if (new Date(invite.invite_expires_at) < new Date()) {
            throw new Error('Invite expired');
        }
        const valid = await bcrypt.compare(verifier, invite.invite_token) 
        if (!valid) { throw new Error('Invalid invite token'); }

        // If we need role names or client names,  fetch them based on invite.role_ids and invite.client_id
        // This is optional for validation, but needed if the frontend needs to display this info.
        let fullInvite = { ...invite };
        if (invite.client_id) {
            const client = await db('clients').where({ id: invite.client_id }).first();
            fullInvite.client_name = client ? client.name : null;
        }
        if (invite.role_ids && Array.isArray(invite.role_ids) && invite.role_ids.length > 0) {
            const roles = await db('roles').whereIn('id', invite.role_ids).select('id', 'name');
            fullInvite.role_names = roles.map(r => r.name);
        }
        return fullInvite; 
    }

    async acceptInvite({ token, password, googleProfile, name }) {
        return await db.transaction(async trx => {
            const invite = await this.validateInviteToken(token); 
            let user;

            const existingUser = await trx('users').where({ email: invite.email, deleted_at: null }).first();

            if (existingUser) {
                user = existingUser; 
                await trx('users').where({ id: user.id }).update({
                    google_id: googleProfile?.id || null,
                    platform_role: invite.platform_role, 
                });
            } else {
                // Create new user
                [user] = await trx('users').insert({
                    email: invite.email,
                    full_name: name || googleProfile?.displayName || '',
                    password_hash: password ? await bcrypt.hash(password, 12) : null,
                    google_id: googleProfile?.id || null,
                    platform_role: invite.platform_role,
                    status: 'active',
                    is_verified: true
                }).returning('*');
            }

            // Create client membership and assign roles
            if (invite.client_id && user) { 
                const [membership] = await trx('client_memberships').insert({
                    user_id: user.id,
                    client_id: invite.client_id,
                }).onConflict(['user_id', 'client_id']).ignore().returning('*');

                if (invite.role_ids && Array.isArray(invite.role_ids) && membership) {
                    const roleInserts = invite.role_ids.map(role_id => ({
                        membership_id: membership.id,
                        role_id,
                    }));
                    await trx('membership_roles').insert(roleInserts).onConflict().ignore();
                }
            }
            //mark invite accepted
            await trx('invites').where({ id: invite.id }).update({ accepted_at: trx.fn.now() });
            return { id: user.id, email: invite.email };
        }
        );
    }
    async resendInvite(inviteId) {
        const invite = await db('invites').where({ id: inviteId }).first();
        if (!invite) return res.status(404).json({ error: 'Invite not found' });
        if (invite.accepted_at) { throw new Error('Invite already accepted'); }
        const invite_expires_at = new Date(Date.now() + 72 * 60 * 60 * 1000);

        const selector = crypto.randomBytes(8).toString('hex');
        const verifier = crypto.randomBytes(32).toString('hex');
        const invite_token = `${selector}.${verifier}`;
        const tokenHash = await bcrypt.hash(verifier, 12);

        await db('invites').where({ id: invite.id }).update({
            token_selector: selector,
            invite_token: tokenHash, invite_expires_at, updated_at: new Date()
        })

        const inviteUrl = `${process.env.FRONTEND_URL}/accept-invite/${invite_token}`;
        await emailService.queue({ to: invite.email, type: 'invite', payload: { inviteUrl, inviteType: invite.invite_type } });
        return { id: invite.id, email: invite.email, inviteUrl, invite_expires_at };


    }

    async revokeInvite(inviteId) {
        await db('invites').where({ id: inviteId }).update({ invite_expires_at: new Date() });
        return { success: true };
    }
}

module.exports = new InviteService();