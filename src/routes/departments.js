const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const adminOnly = require('../middleware/adminOnly');
const asyncHandler = require('../middleware/asyncHandler');
const auditMiddleware = require('../middleware/auditMiddleware');
const requireRoles = require('../middleware/roles');

// GET /api/departments
router.get('/', requireAuth, loadContext, adminOnly, // Assuming only internal admins can list all departments
  asyncHandler(async (req, res) => {
    let q = db('departments')
    .orderBy('name')
    .select('id', 'name', 'code', 'logo_url', 'contact_email', 'allows_online_payment',
            'wire_transfer_instructions', 'created_at');

    if (req.query.id) {
      // If an id is provided, fetch a single department
      const department = await q.where({ id: req.query.id }).first();
      if (!department) return res.status(404).json({ error: 'Department not found' });
      return res.json(department);
    }

    // Otherwise, fetch all departments
    const departments = await q;
    res.json(departments);
  }));

// GET /api/departments/:id - Get single department details (more granular access)
router.get('/:id', requireAuth, loadContext, // 
  asyncHandler(async (req, res) => {
    const department = await db('departments').where({ id: req.params.id }).first();
    if (!department) return res.status(404).json({ error: 'Department not found' });
    res.json(department);
  }));

// POST /api/departments  (admin only)
router.post('/', requireAuth, loadContext, adminOnly,
  auditMiddleware({ action: 'department.created', resourceType: 'department' }),
  asyncHandler(async (req, res) => {
    const departmentData = { ...req.body };
    if (!departmentData.name) return res.status(400).json({ error: 'Department name is required' });
    const [department] = await db('departments').insert({ ...departmentData, created_at: new Date(), updated_at: new Date() }).returning('*');
    res.status(201).json(department);
  }));

//PUT /api/departments/:id  (admin only)
router.put('/:id', requireAuth, loadContext, adminOnly,
  auditMiddleware({ action: 'department.updated', resourceType: 'department' }),
  asyncHandler(async (req, res) => {
    const departmentData = { ...req.body };
    const [department] = await db('departments').where({ id: req.params.id }).update({ ...departmentData, updated_at: new Date() }).returning('*');
    if (!department) return res.status(404).json({ error: 'Department not found' });
    res.json(department);
  }));

module.exports = router;

