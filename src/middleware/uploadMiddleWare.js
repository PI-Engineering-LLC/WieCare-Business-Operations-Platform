
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const crypto = require('crypto');
const { s3Client, getSignedUrl, uploadFile, deleteFile } = require('../storage');
const PUBLIC_BUCKET = process.env.S3_PUBLIC_BUCKET; // For public assets like avatars
const PRIVATE_BUCKET = process.env.S3_PRIVATE_BUCKET; // For private documents like invoices
const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf', 'video/mp4', 'audio/mpeg'];
const allowedExtensions = ['.jpg', '.jpeg', '.png', '.pdf', '.mp4', '.mp3'];
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
        const finalKey = `${req?.clientId ? req.clientId + '/' : ''}users/${req.user.id}/${baseFolder}/${uniqueId}${fileExtension}`;
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
  function parseSizeToBytes(size) {
    const units = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
    const m = String(size).match(/^(\d+)(\w+)$/i);
    return m ? parseInt(m[1]) * (units[m[2].toLowerCase()] || 1) : 10 * 1024 * 1024;
  }
  const fileUpload = (options = {}) => {
    const {
        maxSize = '10mb',
        types = ['application/pdf', 'text/csv', 'application/vnd.ms-excel'], // Default allowed types
        maxFiles = 1,
        fieldName = 'file'
      } = options;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: parseSizeToBytes(maxSize) },
    fileFilter: (req, file, cb) => {
    //     console.log("DEBUG: Incoming mimetype:", file.mimetype); // ADD THIS
    // console.log("DEBUG: Allowed types:", types);
        // if (!file.originalname.match(/\.(csv)$/)) {
            if (!types.includes(file.mimetype)) {
            // Reject file
            // cb(new Error(`File type not allowed. Accepted types: ${allowedExtensions.join(', ')}`), false);

        cb(new Error(`Invalid file type. Allowed: ${types.join(', ')}`), false);
      } else {
        // Accept file
        cb(null, true);
      }
    }
  });
//   return maxFiles > 1 ? upload.array(fieldName, maxFiles) : upload.single(fieldName);
const middleware = maxFiles > 1 ? upload.array(fieldName, maxFiles) : upload.single(fieldName);
return (req, res, next) => {
    // console.log("--- Multer Middleware Entered ---");
    middleware(req, res, (err) => {
    //   console.log("--- Multer Finished ---");
    //   console.log("req.file:", req.file); // THIS is the critical log
    //   console.log("req.body:", req.body);
      
      if (err) {
        console.error("Multer Error:", err);
        return next(err);
      }
      next();
    });
  };

}

  module.exports = { fileUpload,
   uploadMiddleware 
  };