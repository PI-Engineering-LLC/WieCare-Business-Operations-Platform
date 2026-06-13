const router = require('express').Router();
const { s3Client, getSignedUrl, deleteFile, uploadMiddleware } = require('../storage');
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const clientContext = require('../middleware/clientContext');
const resolveClientContext = require('../middleware/resolveClientContext');
const adminOnly = require('../middleware/adminOnly');
const clientScope = require('../middleware/clientScope');
const asyncHandler = require('../middleware/asyncHandler');
const auditMiddleware = require('../middleware/auditMiddleware');

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl: getSignedUrlForUpload  } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const path = require('path');

// POST /api/upload (generates a presigned URL for client-side direct upload)
router.post('/', requireAuth,loadContext,resolveClientContext,
  auditMiddleware({action: 'upload.created', resourceType:'upload'}),
  asyncHandler( async(req, res) => {
  try{
  const clientId = req?.clientId; 
  const user = req.user;
  const { filename, contentType, type, isPrivate } = req.body;
  if (!filename || !contentType) {
    return res.status(400).json({ error: 'filename and contentType are required' });
  }
  const fileExtension  = path.extname(filename);
  const uniqueId = crypto.randomBytes(8).toString('hex');

  // Determine the storage key based on file type and privacy
  let uniqueKey;
  let targetBucket;
  if (type === 'thumbnail' || !isPrivate) {
    targetBucket = process.env.S3_PUBLIC_BUCKET;
    uniqueKey = !!clientId? `${clientId}/public/users/user_${user.id}/${type || 'public'}_${uniqueId}${fileExtension}`: `public/users/user_${user.id}/${type || 'public'}_${uniqueId}${fileExtension}`;
  } else{
    targetBucket = process.env.S3_PRIVATE_BUCKET;
    uniqueKey = !!clientId?  `${clientId}/private/users/user_${user.id}/${type || 'documents'}/id_${uniqueId}${fileExtension}` : `private/users/user_${user.id}/${type || 'documents'}/id_${uniqueId}${fileExtension}`;
  }
  if (!targetBucket) {
    throw new Error(`Configuration Error: Target bucket for ${isPrivate ? 'private' : 'public'} files is not set.`);
  }
  
  const commandParams = {
    Bucket: targetBucket,
    Key: uniqueKey,
    ContentType: contentType, // Enforces that the client uploads the promised file type
  };
  if (!isPrivate && process.env.STORAGE_TYPE !== 'r2') {
    commandParams.ACL = 'public-read'; 
  }
  const command = new PutObjectCommand(commandParams);
  const presignedUrl = await getSignedUrlForUpload(s3Client, command, { expiresIn: 900 }); //15 minutes
  res.json({
    file_url: presignedUrl,
    file_key: uniqueKey // The frontend will pass this back to you to save in the DB after a successful upload
  });

} catch (error) {
  console.error('Error generating presigned URL:', error);
  res.status(500).json({ error: 'Failed to generate secure upload link' });
}


}));


// POST /api/uploads/view-private (generates a presigned URL for private file download)
router.post('/view-private', requireAuth,loadContext,resolveClientContext,
  asyncHandler( async (req, res) => {
  try {
    const clientId = req?.clientId; 
    const user = req.user; // Populated by your auth middleware
    const { fileKey } = req.body; // e.g., "tenant_abc123/users/user_987/id_docs/passport.pdf"

    // 1. RBAC & Tenant Protection Guardrails
    if (!(req.user.isInternalAdmin || fileKey.startsWith(`${clientId}/public/`) || fileKey.startsWith(`${clientId}/private/`) || fileKey.startsWith(`public`))) {
      return res.status(403).json({ error: "Access denied: Tenant mismatch." });
    }

    //TODO Ensure the user owns this file, OR is an admin/authorized role
    const isOwner = fileKey.includes(`/users/user_${user.id}/`);
    const isAdmin = req.user.isInternalAdmin // Example RBAC check

    // if (!isOwner && !isAdmin) {
    //   return res.status(403).json({ error: "You do not have permission to view this document." });
    // } // Allow client to view files owned and uploaded by admin
    const linkExpiration = 3600; //3600s or 1h

    const downloadUrl = await getSignedUrl(fileKey, linkExpiration, process.env.S3_PRIVATE_BUCKET);
    // 3. Return the temporary absolute URL to React
    return res.json({ downloadUrl });

  } catch (error) {
    console.error(error);
    console.error('Error generating signed URL for private file:', error);
    return res.status(500).json({ error: "Failed to generate access link." });
  }
}));
// DELETE /api/uploads (for deleting files)
router.delete('/', requireAuth, loadContext, resolveClientContext, adminOnly, // Assuming only admins can delete files
  asyncHandler(async (req, res) => {
    try {
      const { fileKey, isPrivate } = req.body;
      if (!fileKey) {
        return res.status(400).json({ error: 'fileKey is required' });
      }
      // Implement additional RBAC checks here if needed for deletion logic
      await deleteFile(fileKey, isPrivate);
      res.json({ message: `File ${fileKey} deleted successfully.` });
    } catch (error) {
      console.error('Error deleting file:', error);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  })
);

// Route for backend-proxied single file upload with middleware checks
router.post('/proxy-upload', requireAuth, loadContext, resolveClientContext,
  uploadMiddleware.single('file'), // Use the multer middleware here, 'file' is the field name
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded or file type not allowed.' });
    }

    // req.file contains information about the uploaded file from multerS3
    // E.g., req.file.key, req.file.location (the direct URL from S3 if public), req.file.bucket
    const { key, location, bucket } = req.file;

    // Determine the final URL for the frontend
    let fileUrlForFrontend = location; // This will be the direct S3/R2 URL if public
    const isPrivate = bucket === process.env.S3_PRIVATE_BUCKET;

    if (isPrivate) {
      // If it's a private file, you'll need to generate a signed URL for access
      fileUrlForFrontend = await getSignedUrl(key, 3600, bucket);
    }

    res.json({
      message: 'File uploaded successfully via backend proxy.',
      file_key: key,
      file_url: fileUrlForFrontend, // This is the URL to access the file
      is_private: isPrivate,
    });
  })
);
module.exports = router;
