require('dotenv').config(); 
const db = require('../db');
const inviteService = require('../services/invite'); 
const { startWorkers, stopWorkers } = require('../workers/startWorkers')
const seedAdmin = async () => {
    try {
      await db.raw('SELECT 1');
        console.log('✓ Database connection verified for seeding.');

        // --- START PG-BOSS WORKERS ---
        // await startWorkers(); // <--- START PG-BOSS AFTER DB IS READY
        // console.log('✓ pg-boss workers started for seeding operations.');

        const adminEmailsStr = process.env.ADMIN_EMAILS; // Expecting a comma-separated list

        if (!adminEmailsStr) {
            throw new Error("Missing ADMIN_EMAILS in environment variables. Please provide a comma-separated list of admin emails.");
        }

        const adminEmails = adminEmailsStr.split(',').map(email => email.trim()).filter(Boolean); // Split, trim, and remove empty strings

        if (adminEmails.length === 0) {
            console.log("No valid admin emails provided in ADMIN_EMAILS. Skipping admin seeding.");
            // process.exit(0);
            return;
        }

        let atLeastOneActionTaken = false;

        for (const email of adminEmails) {
            console.log(`Processing admin email: ${email}`);
            let existingUser = await db("users")
                .where({ email })
                .first();

            if (existingUser) {
                // User with this email already exists
                if (existingUser.platform_role === 'super_admin') {
                    console.log(`  User ${email} is already a super admin. No action needed.`);
                } else {
                    // User exists but is not a super_admin. Upgrade their role.
                    console.log(`  User ${email} found, but is not super_admin. Upgrading role.`);
                    const updateData = {
                        platform_role: 'super_admin',
                        is_verified: true, // Assume verified since we're promoting them
                        status: 'active', // Ensure the account is active
                        updated_at: new Date()
                    };

                    await db("users").where({ email }).update(updateData);
                    console.log(`  User ${email} successfully updated to super_admin. They will log in with their existing credentials.`);
                    atLeastOneActionTaken = true;
                }
            } else {
                // No user with this email exists. Create an invite for them.
                console.log(`  No user found with ${email}. Creating super admin invite.`);
                await inviteService.createInvite({
                    email,
                    platformRole: 'super_admin',
                    inviteType: 'platform'
                });
                console.log(`  Super admin invite sent to ${email}. They need to accept the invite to complete setup.`);
                atLeastOneActionTaken = true;
            }
        }

        if (atLeastOneActionTaken) {
            console.log("\nAdmin seeding process completed.");
        } else {
            console.log("\nNo changes were needed for the provided admin emails.");
        }
        process.exit(0);

    } catch (err) {
        console.error("Error during admin seeding:", err);
        process.exitCode = 1
        // process.exit(1);
    }finally {
      // --- STOP PG-BOSS WORKERS ---
      // await stopWorkers(); // <--- STOP PG-BOSS HERE
      // console.log('pg-boss workers stopped after seeding.');

      // --- DESTROY KNEX DB CONNECTION ---
      // This ensures all database connections are properly closed and resources released.
      await db.destroy();
      console.log('Database connection pool destroyed after seeding.');
      process.exit(0); // Exit successfully if no error occurred (or after handling error)
  }
};

seedAdmin();
module.exports = seedAdmin;