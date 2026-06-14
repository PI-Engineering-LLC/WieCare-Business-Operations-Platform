const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const loadContext = require('../middleware/loadContext');
const clientContext = require('../middleware/clientContext');
const resolveClientContext = require('../middleware/resolveClientContext');
const clientScope = require('../middleware/clientScope');
const asyncHandler = require('../middleware/asyncHandler');
const auditMiddleware = require('../middleware/auditMiddleware');
const requireRoles = require('../middleware/roles');
const { getSignedUrl: storageGetSignedUrl, deleteFile } = require('../storage');

router.get('/', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    let q = db('documents').where({ status: 'active' }).orderBy('created_at', 'desc');

    if (!req.user.isInternalAdmin) {
      // Clients see: public docs matching their coaster, OR their own private docs
      q = q.where((builder) => {
        builder
          .where({ is_public: true, coaster_name: req.membership.client.coaster_name })
          .orWhere({ client_id: req.clientId });
      });
    }

    if (req.query.category) q = q.where({ category: req.query.category });
    if (req.query.invoice_id) q = q.where({ invoice_id: req.query.invoice_id });
    if (req.query.client_id) q = q.where({ client_id: req.query.client_id });
    if (req.query.coaster_name) q = q.where({ coaster_name: req.query.coaster_name });
    if (req.query.is_public === true) q = q.where({ is_public: true });
    if (req.query.status) q = q.where({ status: req.query.status });
    // q = clientScope(q, req);
    let result;
    if (req.query.id) {
      result = await q.where({ id: req.query.id }).first();
      if (!result) return res.status(404).json({ error: 'Document not found' });
    } else {
      result = await q;
    }

    res.json(result);
  }));

router.get('/:id/download', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    
    const { id } = req.params;
    const clientId = req.clientId;
    const doc = await db('documents').where({ id }).first();
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const documentId = doc.id
    // Determine the correct bucket based on the document's privacy status
    const targetBucket = doc.is_private ? process.env.S3_PRIVATE_BUCKET : process.env.S3_PUBLIC_BUCKET;

    if (!targetBucket) {
      // This indicates a server configuration issue if the bucket environment variable isn't set
      return res.status(500).json({ error: 'Server configuration error: Document storage bucket not defined.' });
    }
    try{
    
    
    const temporaryViewUrl = await storageGetSignedUrl(doc.file_storage_key, 300, targetBucket);
    
    res.json({ downloadUrl: temporaryViewUrl });
    }catch(error){
      if (error.code === "R2_FILE_NOT_FOUND") {
        console.warn(`File missing for doc ${documentId}. Cleaning up database.`);
        
        // Remove the orphaned record from Postgres
        await db('documents').where({ id: documentId}).update({ file_storage_key: null, status: 'archived' });
        
        return res.status(404).json({
          code: "FILE_MISSING_IN_STORAGE",
          message: "The document was missing from storage and has been removed from the registry."
        });
      }
  
      // Handle normal server/database crashes
      console.error("Unexpected error in document route:", error);
      return res.status(500).json({ message: "Internal server error." });
   
    
  }

  }));
// router.get('/:id', requireAuth, async (req, res) => {
//   const doc = await db('documents').where({ id: req.params.id }).first();
//   if (!doc) return res.status(404).json({ error: 'Not found' });
//   res.json(doc);
// });

router.post('/', requireAuth, loadContext, requireRoles(['client_admin', 'super_admin', 'platform_admin']),
  auditMiddleware({ action: 'document.created', resourceType: 'document' }),
  asyncHandler(async (req, res) => {
    const [doc] = await db('documents').insert({
      ...req.body,
      tags: JSON.stringify(req.body.tags ?? []),
      created_by: req.user.id
    }).returning('*');
    res.status(201).json(doc);
  }));

router.patch('/:id', requireAuth, loadContext, adminOnly,
  auditMiddleware({ action: 'document.updated', resourceType: 'document' }),
  asyncHandler(async (req, res) => {
    const [doc] = await db('documents').where({ id: req.params.id }).update({...req.body,tags: JSON.stringify(req.body.tags ?? [])}).returning('*');
    res.json(doc);
  }));

router.delete('/:id', requireAuth, loadContext, adminOnly,
  auditMiddleware({ action: 'document.deleted', resourceType: 'document' }),
  asyncHandler(async (req, res) => {
    const doc = await db('documents').where({ id: req.params.id }).first();
    await deleteFile(doc.file_storage_key, true); //All documents are private on r2, avatars are public
    await db('documents').where({ id: doc.id }).update({ status: 'archived' });
    res.json({ success: true });
  }));

module.exports = router;