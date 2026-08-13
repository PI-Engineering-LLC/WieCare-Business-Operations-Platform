/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
    await knex.raw('ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_number_unique UNIQUE (invoice_number)');
  };
  exports.down = async (knex) => {
    await knex.raw('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_unique');
  };