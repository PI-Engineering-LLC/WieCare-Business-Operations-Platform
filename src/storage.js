const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl: awsGetSignedUrl  } = require('@aws-sdk/s3-request-presigner');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const DRIVER = process.env.STORAGE_TYPE || 'local'; // 'local' | 'r2' | 'minio' | 's3'
const LOCAL_DIR = path.join(__dirname, '../../uploads');
//Define separate buckets for public and private
const PUBLIC_BUCKET = process.env.S3_PUBLIC_BUCKET; // For public assets like avatars
const PRIVATE_BUCKET = process.env.S3_PRIVATE_BUCKET; // For private documents like invoices

let s3Client;
if (DRIVER !== 'local') {
  s3Client = new S3Client({
    region:   process.env.S3_REGION    || 'auto',  // R2 uses 'auto'
    endpoint: process.env.S3_ENDPOINT,              // R2: https://<account>.r2.cloudflarestorage.com
    credentials: {
      accessKeyId:     process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
    // R2 requires path-style — as does MinIO
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });
}
/**
 * * General purpose function to upload a file buffer directly to S3/R2.
 * This is useful if your backend has the file as a buffer (e.g., from an internal process).
 * If using multerS3, multer handles the upload directly, bypassing this function for the actual transfer.
 *  Returns { key, url, size, mimeType }
 */
async function uploadFile(fileBuffer, originalName, mimeType, folder = 'general', isPrivate = false, key = null) {
  const targetBucket = isPrivate ? PRIVATE_BUCKET : PUBLIC_BUCKET;
  if (!targetBucket) {
    throw new Error(`Configuration Error: Target bucket for ${isPrivate ? 'private' : 'public'} files is not set.`);
  }
  const uniqueKey = key || (() => {
    const ext = path.extname(originalName);
    return `${folder}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  })();

  if (DRIVER === 'local') {
    const dir = path.join(LOCAL_DIR, path.dirname(uniqueKey));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(LOCAL_DIR, uniqueKey), fileBuffer);
    return {
      key: uniqueKey,
      url: `${process.env.BACKEND_URL}/uploads/${uniqueKey}`,
      size: fileBuffer.length,
      mimeType,
    };
  }
  // ─── S3 / R2 / MinIO ───
  const commandParams = {
    Bucket:      targetBucket,
    Key:         uniqueKey,
    ContentType: mimeType,
    Body:        fileBuffer,
  };
  // Only set ACL for public files.
  // Note: Cloudflare R2 does NOT support ACLs — public access is controlled
  // at the bucket level in the R2 dashboard. For R2, skip the ACL entirely.
  // For AWS S3 or MinIO, this enables per-object public access.
  if (!isPrivate && DRIVER !== 'r2') {
    commandParams.ACL = 'public-read';
  }

  await s3Client.send(new PutObjectCommand(commandParams));

  // Public URL (R2 custom domain or presigned for private)
  // Determine URL:
  //   - Public + S3_PUBLIC_URL set → permanent CDN URL (fast, no expiry)
  //   - Private or no S3_PUBLIC_URL → signed URL (1 hour)
  let url;
  if (!isPrivate && process.env.S3_PUBLIC_URL) {
    url = `${process.env.S3_PUBLIC_URL}/${uniqueKey}`;
  } else {
    url = await getSignedUrl(uniqueKey, 3600, targetBucket);
  }

  return { key: uniqueKey, url, size: fileBuffer.length, mimeType };
}

/**
 * Get a signed URL for private file access.
 * Default 1 hour expiry.
 */
async function getSignedUrl(key, expirySeconds = 3600, bucket){
  if (DRIVER === 'local') {
    return `${process.env.BACKEND_URL}/uploads/${key}`;
  }
  if (!bucket) {
    // Attempt to infer if key starts with a common private prefix, or default to private
    bucket = key.includes('/private/') || key.includes('/documents/') ? PRIVATE_BUCKET : PUBLIC_BUCKET;
    if (!bucket) throw new Error('Bucket not specified and could not be inferred for signed URL.');
  }
  return awsGetSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expirySeconds }
  );
}
/**
 * Delete a file from storage.
 */
async function deleteFile(key, isPrivate = false) {
  if (DRIVER === 'local') {
    const fp = path.join(LOCAL_DIR, key);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    return;
  }
  const targetBucket = isPrivate ? PRIVATE_BUCKET : PUBLIC_BUCKET;
  if (!targetBucket) {
    throw new Error(`Configuration Error: Target bucket for ${isPrivate ? 'private' : 'public'} files is not set.`);
  }
  await s3Client.send(new DeleteObjectCommand({ Bucket: targetBucket, Key: key }));
}

// Multer setup - if you are actually using this for direct server-side uploads.
// Assumes uploads to the public bucket by default.
const upload = multer({
  storage: multerS3({
    s3: s3Client, // Use the initialized s3Client
    bucket: PUBLIC_BUCKET, // Default for multer to public files
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      // Ensure req.clientId and req.user.id are populated by preceding middleware
      const folder = req.user?.id ? `users/${req.user.id}/avatars` : 'general'; // Example path
      cb(null, `${req.clientId}/${folder}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
    contentType: multerS3.AUTO_CONTENT_TYPE, // Auto-detect content type
  }),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// ----------------------------------------------------
// Multer middleware for backend-proxied uploads
// (i.e., client sends file to your Express route, then Express sends to S3/R2)
// This will replace the need for the `uploadFile` method being called manually in the route handler.
// ----------------------------------------------------

const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf', 'video/mp4', 'audio/mpeg'];
const allowedExtensions = ['.jpg', '.jpeg', '.png', '.pdf', '.mp4', '.mp3'];

// This `uploadMiddleware` will be used in your Express routes like `router.post('/', uploadMiddleware.single('file'))`
const uploadMiddleware = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: (req, file, cb) => {
      // Dynamic bucket selection based on req.body.isPrivate
      // Frontend needs to send { isPrivate: 'true' | 'false' } in the form data
      const isPrivate = req.body.isPrivate === 'true';
      const targetBucket = isPrivate ? PRIVATE_BUCKET : PUBLIC_BUCKET;

      if (!targetBucket) {
        return cb(new Error(`Server config error: Target bucket not set for private=${isPrivate}`));
      }
      cb(null, targetBucket);
    },
    key: (req, file, cb) => {
      const isPrivate = req.body.isPrivate === 'true';
      const fileExtension = path.extname(file.originalname);
      const uniqueId = crypto.randomBytes(8).toString('hex');

      // Example paths:
      // Public: clientId/users/userId/avatars/uniqueId.jpg
      // Private: clientId/users/userId/documents/uniqueId.pdf
      const baseFolder = isPrivate ? 'documents' : (req.body.type || 'general'); // Use req.body.type if specified
      const finalKey = `${req.clientId}/users/${req.user.id}/${baseFolder}/${uniqueId}${fileExtension}`;
      cb(null, finalKey);
    },
    contentType: multerS3.AUTO_CONTENT_TYPE, // Automatically detect and set content type
    // If you need custom ACLs for non-R2 S3 buckets:
    // acl: (req, file, cb) => {
    //   const isPrivate = req.body.isPrivate === 'true';
    //   cb(null, isPrivate ? 'private' : 'public-read');
    // },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype;

    if (!allowedExtensions.includes(ext) || !allowedMimeTypes.includes(mimeType)) {
      // Reject file
      cb(new Error(`File type not allowed. Accepted types: ${allowedExtensions.join(', ')}`), false);
    } else {
      // Accept file
      cb(null, true);
    }
  }
});

module.exports = { upload, s3Client, getSignedUrl, deleteFile, uploadFile,uploadMiddleware };
