const { z } = require('zod');


// const invoiceItemSchema = z.object({
//     description: z.string().min(1).max(500),
//     quantity: z.coerce.number().positive(),
//     unit_price: z.coerce.number().min(0),
//     tax_rate: z.coerce.number().min(0).max(100).default(0),
//   })
//   .looseObject(); // allow extra fields if needed
  
//   const createInvoiceSchema = z.object({
//     client_id: z.string().uuid(),
//     sending_entity: z.string().nullable().optional(),
//     title: z.string().min(1).max(200),
//     total_amount: z.number().min(0),
//     // amount_paid: z.number().min(0).default(0),
//     currency: z.string().length(3).default('USD'),
//     status: z.enum(['draft', 'sent', 'invoiced', 'pending', 'partial', 'paid', 'overdue', 'void']).default('draft'),
//     issue_date: z.union([z.string(), z.date()]).nullable().optional(),
//     due_date: z.union([z.string(), z.date()]).nullable().optional(),
//     // order_id: z.string().uuid().nullable().optional(),
//     // order_id: z.preprocess(
//     //     (val) => (val === '' || val === undefined ? null : val),
//     //     z.uuid().nullable().optional()
//     //   ),
//     //   amount_paid: z.coerce.number().min(0).optional(),
//     //   items: z.array(invoiceItemSchema).optional(),
//     // notes: z.string().max(2000).optional(),
//     // items: z.array(invoiceItemSchema).default([]),
//     // explicitly NOT allowed — prevents mass assignment:
//     // id, created_by, balance_due, invoice_number — omitted on purpose
//   }).looseObject(); // rejects unknown keys
const createInvoiceSchema = z.object({
    // Required fields for creation
    client_id: z.uuid(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
    sending_entity: z.string().nullable().optional(),
    // Fields that might be empty/null and need preprocessing
    order_id: z.preprocess(
      (val) => (val === '' || val === undefined ? null : val),
      z.uuid().nullable().optional()
    ),
    notes: z.string().nullable().optional(),
    currency: z.string().default('USD'),
  
    // Items processing (mapped to invoice_line_items)
    items: z.array(z.object({
      line: z.coerce.number().optional(),
      item_number: z.string().optional(),
      ez_number: z.string().optional(),
      amount: z.coerce.number().nonnegative(),
      total: z.coerce.number().nonnegative(),
      description: z.string().min(1),
      quantity: z.coerce.number().positive(),
      unit_price: z.coerce.number().nonnegative(),
      // tax_rate is optional, defaults to 0 in your recalc logic
      tax_rate: z.coerce.number().optional().default(0)
    })).min(1, "At least one item is required")
  }).passthrough();
  
  const updateInvoiceSchema = z.object({
    client_id: z.uuid().optional(),
    // sending_entity: z.string().min(1).transform((val) => val.trim()),
    sending_entity: z.string().nullable().optional(),
    title: z.string().min(1).max(200).optional(),
    total_amount: z.number().min(0).optional(),
    // amount_paid: z.number().min(0).optional(),
    currency: z.string().length(3).optional(),
    status: z.enum(['draft', 'sent', 'invoiced', 'pending', 'partial', 'paid', 'overdue', 'void']).optional(),
    issue_date: z.union([z.string(), z.date()]).nullable().optional(),
    due_date: z.union([z.string(), z.date()]).nullable().optional(),
    // order_id: z.string().uuid().nullable().optional(),
    notes: z.string().max(2000).optional(),
    // items: z.array(invoiceItemSchema).optional(),
    amount_paid: z.coerce.number().min(0).optional(),
    order_id: z.preprocess(
      (val) => (val === '' || val === undefined ? null : val),
      z.uuid().nullable().optional()
    ),
    items: z.array(z.object({
        line: z.coerce.number().optional(),
      item_number: z.string().optional(),
      ez_number: z.string().optional(),
      amount: z.coerce.number().nonnegative(),
      total: z.coerce.number().nonnegative(),
        description: z.string().min(1),
        quantity: z.coerce.number().positive(),
        unit_price: z.coerce.number().nonnegative(),
        tax_rate: z.coerce.number().default(0)
      })).optional(),
    // items: z.array(invoiceItemSchema).optional(),
  }).passthrough();
  module.exports = { createInvoiceSchema, updateInvoiceSchema };