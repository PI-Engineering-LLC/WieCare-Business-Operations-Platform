const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', 
    auth: {
      user: process.env.SMTP_USER, 
      pass: process.env.SMTP_PASS, 
    },
  tls: {
    rejectUnauthorized: false 
  }
  });
  const sendEmail = async ({ to, subject, body, from }) =>{
    try {
        const info = await transporter.sendMail({
            from: ` ${from || "Wiegand"} <${process.env.EMAIL_FROM}>`,
            to, subject,
            html: body

        });
        console.log('Email sent:', info.response);
        return info;
      } catch (error) {
        console.error('Error sending email:', error);
        throw error;
      }
    
    
  }
  transporter.verify((err) => {
    if (err) console.error('SMTP connection failed:', err.message);
    else     console.log('✓ SMTP transporter ready');
  });


module.exports = { sendEmail };
