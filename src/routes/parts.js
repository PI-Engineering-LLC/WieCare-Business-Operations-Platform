const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const clientContext = require('../middleware/clientContext');
const resolveClientContext = require('../middleware/resolveClientContext');
const adminOnly = require('../middleware/adminOnly');
const clientScope = require('../middleware/clientScope');
const asyncHandler = require('../middleware/asyncHandler');
const auditMiddleware = require('../middleware/auditMiddleware');
const {fileUpload} = require('../middleware/uploadMiddleWare');
const holdCheck = require('../middleware/holdCheck');
const { initializeAndStartBoss, getBossInstance }  = require('../jobs/boss');
const { s3Client, getSignedUrl, uploadFile, deleteFile } = require('../storage');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl: getSignedUrlForUpload  } = require('@aws-sdk/s3-request-presigner');


/**client.on_hold
  if (part.holdUntil && now < part.holdUntil) {
    return res.status(403).json({ message: 'This part is on hold due to overdue invoice' });
  } */
// Parts catalog
router.get('/', requireAuth,loadContext,resolveClientContext,adminOnly,
  asyncHandler( async (req, res) => {

  let q = db('parts').orderBy('name');
  if (req.query.status) q = q.where({ status: req.query.status });
  if (req.query.category) q = q.where({ category: req.query.category });
  
    q = clientScope(q, req);
    let result;
  if (req.query.id) {
    result = await q.where({ id: req.query.id }).first();
    if (!result) return res.status(404).json({ error: 'Part not found' });
  } else {
    result = await q; 
  }

  res.json(result);
}));

// router.get('/:id', requireAuth, async (req, res) => {
//   const part = await db('parts').where({ id: req.params.id }).first();
//   if (!part) return res.status(404).json({ error: 'Not found' });
//   res.json(part);
// });

router.get('/imports/:id', requireAuth,loadContext, adminOnly, async (req, res) => {
  const job = await db('imports').where({ id: req.params.id }).first();
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json(job);
  /**res.json({
    status: importJob.status,
    processed_rows: importJob.processed_rows,
    failed_rows: importJob.failed_rows
  }); */
});


router.post('/', requireAuth,loadContext, adminOnly,
  auditMiddleware({action: 'part.created', resourceType:'part'}),
  asyncHandler( async (req, res) => {
  const [part] = await db('parts').insert(req.body).returning('*');
  res.status(201).json(part);
}));
router.post('/imports', 
  // requireAuth,loadContext, adminOnly, 
  // uploadMiddleware.single('file'),
  // (req, res, next) => {
  //   console.log('Incoming request content-type:', req.headers['content-type'], req.files, req.file, req.body);
  //   next();
  // },
  fileUpload({ maxSize: '10mb', allowedTypes: ['text/csv', 'application/vnd.ms-excel'] }), // Add CSV/Excel types
  auditMiddleware({action: 'part.imported', resourceType:'part'}),
  asyncHandler( async (req, res) => {
    const { file } = req; // Assuming multer middleware is used
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
     // 1. Upload to R2 (or if you already have the file locally, just move to storage)
    // const fileUrl = await uploadFile(file); 
    const { key } = await uploadFile(file.buffer, file.originalname, file.mimetype, 'imports', true);

    // 2. Create the job record
  const [importJob] = await db('imports').insert({
    client_id: req.clientId,
    file_url:  key,
    status: 'pending'
  }).returning('*');

  // 3. Queue the background job
  // await getBoss().send('import-csv', { importId: importJob.id });
  const boss = await initializeAndStartBoss(); 
  if (!boss) {
    console.error("Attempted to queue email, but PgBoss failed to start or is not started after initializeAndStartBoss. Critical error.");
      throw new Error("Email queuing service unavailable due to PgBoss startup failure.");
   
}
await boss.send('import-csv', { importId: importJob.id });

  // 4. Return immediately
  res.status(202).json({ import_id: importJob.id, status: 'pending' });
}));

router.patch('/:id', requireAuth,loadContext, adminOnly,
  auditMiddleware({action: 'part.updated', resourceType:'part'}),
  asyncHandler( async (req, res) => {
  const [part] = await db('parts').where({ id: req.params.id }).update(req.body).returning('*');
  res.json(part);
}));

router.delete('/:id', requireAuth,loadContext, adminOnly,
  auditMiddleware({action: 'part.deleted', resourceType:'part'}),
  asyncHandler( async (req, res) => {
  await db('parts').where({ id: req.params.id }).delete();
  res.json({ success: true });
}));

// Part orders
router.get('/orders', requireAuth,loadContext,resolveClientContext,
  asyncHandler( async (req, res) => {
    
  let q = db('part_orders').orderBy('created_at', 'desc');
  
    q = clientScope(q, req);
    let result;
  if (req.query.id) {
    result = await q.where({ id: req.query.id }).first();
    if (!result) return res.status(404).json({ error: 'Part Order not found' });
  } else {
    result = await q; 
  }

  res.json(result);
}));

router.post('/orders', requireAuth,loadContext,resolveClientContext,holdCheck,
  auditMiddleware({action: 'part_order.created', resourceType:'part_order'}),
  asyncHandler( async (req, res) => {
  const client = await db('clients').where({ id: reqclientId }).first();

  const [po] = await db('part_orders').insert({
    ...req.body,
    client_id: client.id,
    created_by: req.user.id,
    order_number: `PO-${Date.now().toString().slice(-6)}`
  }).returning('*');
  res.status(201).json(po);
}));

router.patch('/orders/:id', requireAuth,loadContext,resolveClientContext, adminOnly,
  auditMiddleware({action: 'part_order.updated', resourceType:'part_order'}),
  asyncHandler( async (req, res) => {
  const [po] = await db('part_orders').where({ id: req.params.id }).update(req.body).returning('*');
  res.json(po);
}));

module.exports = router;