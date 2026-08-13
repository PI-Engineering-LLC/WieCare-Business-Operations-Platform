/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
    // 1. Create the sequence, starting at 1
    await knex.raw('CREATE SEQUENCE invoice_number_seq START 1');
  
    // 2. Optional: if you have existing invoices, advance the sequence
    //    past the highest existing numeric suffix so you don't collide.
    //    This finds the max number after "INV-" and sets the sequence there.
    await knex.raw(`
      SELECT setval(
        'invoice_number_seq',
        COALESCE(
          (SELECT MAX(CAST(SUBSTRING(invoice_number FROM 5) AS INTEGER))
           FROM invoices
           WHERE invoice_number ~ '^INV-[0-9]+$'),
          1
        ),
        true
      )
    `);
  };
  
  exports.down = async (knex) => {
    await knex.raw('DROP SEQUENCE IF EXISTS invoice_number_seq');
  };
