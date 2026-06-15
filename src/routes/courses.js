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
const { getSignedUrl: storageGetSignedUrl, deleteFile } = require('../storage');


// Courses
router.get('/', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    let q = db('courses').whereNot('status', 'archived').orderBy('order_index');
    if (req.query.status) q = q.where({ status: req.query.status });
    if (!req.user.isInternalAdmin) q = q.where({ status: 'published' });
    let result;
    if (req.query.id) {
      result = await q.where({ id: req.query.id }).first();
      if (!result) return res.status(404).json({ error: 'Course not found' });
    } else {
      result = await q;
    }
    res.json(result);
  }));
router.get('/:id/download', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const clientId = req.clientId;
    const course = await db('courses').where({ id }).first();
    if (!course) return res.status(404).json({ error: 'Not found' });
    const courseId = course.id
    // Determine the correct bucket based on the document's privacy status
    const targetBucket = course.is_private ? process.env.S3_PRIVATE_BUCKET : process.env.S3_PUBLIC_BUCKET;

    if (!targetBucket) {
      // This indicates a server configuration issue if the bucket environment variable isn't set
      return res.status(500).json({ error: 'Server configuration error: Document storage bucket not defined.' });
    }
    try{
    const temporaryViewUrl = await storageGetSignedUrl(course.video_storage_key, 300, targetBucket);
    res.json({ downloadUrl: temporaryViewUrl });
    }catch(error){
      if (error.code === "R2_FILE_NOT_FOUND") {
        console.warn(`File missing for doc ${courseId}. Cleaning up database.`);
        
        // Remove the orphaned record from Postgres
        await db('courses').where({ id: courseId }).update({ video_storage_key: null , status: 'archived'});
        
        return res.status(404).json({
          error: "FILE_MISSING_IN_STORAGE",
          message: "The course was missing from storage and has been removed from the registry."
        });
      }
  
      // Handle normal server/database crashes
      console.error("Unexpected error in course route:", error);
      return res.status(500).json({ message: "Internal server error." });
   
    
  } 

  }));

router.post('/', requireAuth, loadContext, adminOnly,
  auditMiddleware({ action: 'course.created', resourceType: 'course' }),
  asyncHandler(async (req, res) => {
    const [course] = await db('courses').insert(req.body).returning('*');
    res.status(201).json(course);
  }));

router.patch('/:id', requireAuth, loadContext, resolveClientContext,
  auditMiddleware({ action: 'course.updated', resourceType: 'course' }),
  asyncHandler(async (req, res) => {
    const newData = req.body;
    const currentCourse = await db('courses').where({ id: req.params.id }).first();
    if (newData.video_storage_key && newData.video_storage_key !== currentCourse.video_storage_key) {
      try {
        await deleteFile(currentCourse.video_storage_key, true); //All videos are private on r2, avatars are public
      } catch (err) {
        console.error("Failed to delete old file from R2", err);
      }
    }
    if (newData.thumbnail_storage_key && newData.thumbnail_storage_key !== currentCourse.thumbnail_storage_key) {
      try {
        await deleteFile(currentCourse.thumbnail_storage_key); //All videos are private on r2, avatars are public
      } catch (err) {
        console.error("Failed to delete old file from R2", err);
      }
    }
    const [course] = await db('courses').where({ id: req.params.id }).update(req.body).returning('*');
    res.json(course);
  }));

router.delete('/:id', requireAuth, loadContext, adminOnly,
  auditMiddleware({ action: 'course.deleted', resourceType: 'course' }),
  asyncHandler(async (req, res) => {
    const currentCourse = await db('courses').where({ id: req.params.id }).first();
    await deleteFile(currentCourse.thumbnail_storage_key);
    await db('courses').where({ id: req.params.id }).delete();
    res.json({ success: true });
  }));
//All course progress
router.get('/progress', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;

    q = db('course_progress').orderBy('last_watched_at', 'desc');
    q = clientScope(q, req);
    // Non-admins can only see their own progress
    if (!req.user.isInternalAdmin && req.query.user_id !== req.user.id)
      return res.status(403).json({ error: 'Forbidden' });

    if (!req.user.isInternalAdmin) {
      q = q.where({ user_id: userId })
    }
    if (!req.query.user_id) {
      q = q.where({ user_id: req.query.user_id })
    }
    let result;
    if (req.query.id) {
      result = await q.where({ id: req.query.id }).first();
      if (!result) return res.status(404).json({ error: 'Course Progress not found' });
    } else {
      result = await q;
    }

    res.json(result);
  }));
// Course progress
router.get('/:id/progress', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    const progress = await db('course_progress')
      .where({ course_id: req.params.id, user_id: req.user.id })
      .first();
    if (!progress) return res.status(404).json({ error: 'Course Progress not found' });
    res.json(progress);
  }));

router.post('/:id/progress', requireAuth, loadContext, resolveClientContext,
  auditMiddleware({ action: 'course_progress.created', resourceType: 'course_progress' }),
  asyncHandler(async (req, res) => {
    let { status, started_at, progress_percent, watch_time_seconds, last_watched_at, completed_at, course_title} = req.body;
    const watch_time = Math.max(0, Number(watch_time_seconds) || 0);
    const progressPercent = Math.max(0, Number(progress_percent) || 0);;

    const [progress] = await db('course_progress')
      .insert({
        course_id: req.params.id,
        user_id: req.user.id,
        user_email: req.user.email,
        client_id: req.clientId,
        progress_percent: progressPercent,
        watch_time_seconds: watch_time,
        status,
        course_title,
        started_at,
        completed_at: completed_at || null,
        last_watched_at: last_watched_at || new Date()
      })
      .onConflict(['course_id', 'user_id'])
      .merge({
        watch_time_seconds: db.raw('GREATEST(course_progress.watch_time_seconds, EXCLUDED.watch_time_seconds)'),
        status: db.raw('EXCLUDED.status'),
        last_watched_at: new Date(),
      })
      .returning('*');
    res.json({ progress });
  }));

router.patch('/:cid/progress/:id', requireAuth, loadContext, resolveClientContext,
  auditMiddleware({ action: 'course_progress.updated', resourceType: 'course_progress' }),
  asyncHandler(async (req, res) => {
    const course = await db('courses').where({ id: req.params.cid }).first();
    if (!course) return res.status(404).json({ error: 'Course not found' });

    // Sanitize input
    const watch_time = Math.max(0, Number(req.body.watch_time_seconds) || 0);
    const progress_percent = Math.max(0, Number(req.body.progress_percent) || 0);
    const [progress] = await db('course_progress')
      .where({ id: req.params.id, user_id: req.user.id })
      .update({
        watch_time_seconds: watch_time,
        progress_percent: progress_percent,
        last_watched_at: new Date(),
        ...req.body
      })
      .returning('*');

    res.json(progress);
  }));

module.exports = router;