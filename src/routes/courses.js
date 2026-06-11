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

// Courses
router.get('/', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    let q = db('courses').orderBy('order_index');
    if (req.query.status) q = q.where({ status: req.query.status });
    if (!req.user.isInternalAdmin) q = q.where({ status: 'published' });
    // q = clientScope(q, req);
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
    // Determine the correct bucket based on the document's privacy status
    const targetBucket = course.is_private ? process.env.S3_PRIVATE_BUCKET : process.env.S3_PUBLIC_BUCKET;

    if (!targetBucket) {
      // This indicates a server configuration issue if the bucket environment variable isn't set
      return res.status(500).json({ error: 'Server configuration error: Document storage bucket not defined.' });
    }
    const temporaryViewUrl = await storageGetSignedUrl(course.thumbnail_storage_key, 300, targetBucket);
    res.json({ downloadUrl: temporaryViewUrl });

  }));

// router.get('/:id', requireAuth, async (req, res) => {
//   const course = await db('courses').where({ id: req.params.id }).first();
//   if (!course) return res.status(404).json({ error: 'Not found' });
//   res.json(course);
// });

router.post('/', requireAuth, loadContext, adminOnly,
  auditMiddleware({ action: 'course.created', resourceType: 'course' }),
  asyncHandler(async (req, res) => {
    const [course] = await db('courses').insert(req.body).returning('*');
    res.status(201).json(course);
  }));

router.patch('/:id', requireAuth, loadContext, resolveClientContext,
  auditMiddleware({ action: 'course.updated', resourceType: 'course' }),
  asyncHandler(async (req, res) => {
    const [course] = await db('courses').where({ id: req.params.id }).update(req.body).returning('*');
    res.json(course);
  }));

router.delete('/:id', requireAuth, loadContext, adminOnly,
  auditMiddleware({ action: 'course.deleted', resourceType: 'course' }),
  asyncHandler(async (req, res) => {
    await db('courses').where({ id: req.params.id }).delete();
    res.json({ success: true });
  }));
//All course progress
router.get('/progress', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    //   const userId = req.query.user_id || req.user.id;
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
    let { status, started_at, progress_percent, watch_time_seconds,last_watched_at, completed_at, duration_minutes  } = req.body;
    const watch_time = Math.max(0, Number(watch_time_seconds) || 0);
const progressPercent = Math.max(0, Number(progress_percent) || 0);;
    
    // const course = await db('courses').where({ id: req.params.id }).first();
    // if (!course) return res.status(404).json({ error: 'Course not found' });
    // if (duration_minutes && duration_minutes !== course.duration_minutes) {
    //   await db('courses')
    //     .where({ id: req.params.id })
    //     .update({ duration_minutes: duration_minutes });
    //   course.duration_minutes = duration_minutes; // Update the local course object to reflect the change
    // }
    // if(!!watch_time_seconds || isNaN(watch_time_seconds)){
    //   watch_time_seconds =0
    // }
    // console.log("##",duration_minutes, course.duration_minutes, watch_time_seconds, Math.floor(watch_time_seconds/60 /course.duration_minutes ))


    // if(!isNaN(watch_time_seconds) && watch_time_seconds>= course.duration_minutes * 60 * 0.95) status === 'completed' 
    
    const [progress] = await db('course_progress')
    .insert({
      course_id:          req.params.id,
      user_id:            req.user.id,
      user_email:         req.user.email,
      client_id:          req.clientId,
      progress_percent:   progressPercent,
      watch_time_seconds:   watch_time,
      status,
      started_at,
      completed_at : completed_at || null,
      last_watched_at: last_watched_at ||new Date()
    })
    .onConflict(['course_id', 'user_id'])
    .merge({
     watch_time_seconds: db.raw('GREATEST(course_progress.watch_time_seconds, EXCLUDED.watch_time_seconds)'),
     status:  db.raw('EXCLUDED.status'),
      last_watched_at: new Date(),
    })
    .returning('*');
    res.json({ progress });
  }));

router.patch('/:cid/progress/:id', requireAuth, loadContext, resolveClientContext,
  auditMiddleware({ action: 'course_progress.updated', resourceType: 'course_progress' }),
  asyncHandler(async (req, res) => {
    // const courseProgress = await db('course_progress').where({ id: req.params.id , user_id: req.user.id }).first();
    const course = await db('courses').where({ id: req.params.cid }).first();
    if (!course) return res.status(404).json({ error: 'Course not found' });
    // let watch_time_seconds = req.body.watch_time_seconds
    // if(!!watch_time_seconds || isNaN(watch_time_seconds)){      watch_time_seconds =0
    // }
    // let progress_percent;
    // if(req.body.progress_percent && isNaN(req.body.progress_percent)){
    //   progress_percent = req.body.progress_percent

    // }else{
    //   console.log("vvvv",req.body.watch_time_seconds,req.body.progress_percent, course.duration_minutes, watch_time_seconds, Math.floor(watch_time_seconds/60 /course.duration_minutes ))

    //   if(!!req.body.watch_time_seconds || isNaN(req.body.watch_time_seconds)){
    //     progress_percent = Math.floor(req.body.watch_time_seconds /(course.duration_minutes *60) ) * 100
    //     console.log("yyyP",progress_percent)
    //     console.log("yyy",req.body.watch_time_seconds,req.body.progress_percent, course.duration_minutes, watch_time_seconds, Math.floor(watch_time_seconds/60 /course.duration_minutes ))

    //   }else{
    //     progress_percent = Math.floor(courseProgress.watch_time_seconds/60 /course.duration_minutes ) * 100
    //     console.log("nnn",req.body.watch_time_seconds,req.body.progress_percent, course.duration_minutes, watch_time_seconds, Math.floor(watch_time_seconds/60 /course.duration_minutes ))

    //   }
      

    // }
    // // if(!isNaN(watch_time_seconds) && watch_time_seconds>= course.duration_minutes * 60 * 0.95) status === 'completed' 
    
    // console.log("??",req.body.watch_time_seconds,req.body.progress_percent, course.duration_minutes, watch_time_seconds, Math.floor(watch_time_seconds/60 /course.duration_minutes ))
    // const [progress] = await db('course_progress')
    //   .where({ id: req.params.id, user_id: req.user.id })
    //   .update({ ...req.body, last_watched_at: new Date(), progress_percent })
    //   .returning('*');
    // res.json(progress);

// 1. Sanitize input
const watch_time = Math.max(0, Number(req.body.watch_time_seconds) || 0);
// const duration_seconds = (course.duration_minutes || 1) * 60;

// 2. Consistent calculation
const progress_percent = Math.max(0, Number(req.body.progress_percent) || 0);;
// const progress_percent = Math.min(100, Math.floor((watch_time / duration_seconds) * 100));
console.log("vvvv",req.body.watch_time_seconds,req.body.progress_percent, watch_time, progress_percent)
// 3. Simple update
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