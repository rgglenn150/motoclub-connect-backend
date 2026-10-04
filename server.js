import dotenv from 'dotenv';
import express from 'express';
import session from 'express-session';
import mongoose from 'mongoose';
import userRoutes from './routes/user.js';
import authRoutes from './routes/auth.js';
import clubRoutes from './routes/club.js';
import eventRoutes from './routes/event.js';
import notificationRoutes from './routes/notification.js';
import officialMemberRouter from './routes/official-member.js';
import paymentRoutes from './routes/payment.js';
import collectionRoutes from './routes/collection.js';
import shareRoutes from './routes/share.js';
import cors from 'cors';

dotenv.config();

//express app
const app = express();

//middleware
app.use(express.json());
const isProduction =
  process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test';

// Origins used by the Capacitor webview on Android/iOS. Not configurable per
// environment, so they are always allowed.
const nativeOrigins = [
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
];

// Dev servers: `ionic serve` (8100), `ng serve` (4200) and their fallbacks.
const devOrigins = [
  'http://localhost:8100',
  'http://localhost:8101',
  'http://localhost:4200',
  'http://localhost:4201',
];

const configuredOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  : [];

const allowedOrigins = [
  ...new Set([
    ...configuredOrigins,
    ...nativeOrigins,
    ...(isProduction ? [] : devOrigins),
  ]),
];

// `ionic capacitor run android -l --external` serves from the machine's LAN
// address, so the origin is a private IP we can't know ahead of time.
const lanOriginPattern =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

const isOriginAllowed = (origin) => {
  if (allowedOrigins.includes('*')) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (!isProduction && lanOriginPattern.test(origin)) return true;
  return false;
};

const corsOptions = {
  // No origin header: same-origin requests, curl/Postman, native HTTP plugins.
  origin: (origin, cb) => {
    if (!origin || isOriginAllowed(origin)) return cb(null, true);
    console.warn(`CORS: blocked origin ${origin}`);
    // Reject by omitting CORS headers rather than throwing, so the browser
    // reports a CORS failure instead of the server returning a 500.
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};

console.log('CORS allowed origins:', allowedOrigins.join(', '));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use((req, res, next) => {
  console.log(req.path, req.method);
  next();
});

// Configure session middleware
app.use(
  session({
    secret: 'mysecretkey',
    resave: false,
    saveUninitialized: true,
  })
);

//routes
app.use('/api/user', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/club', clubRoutes);
app.use('/api/event', eventRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/official-member', officialMemberRouter);
app.use('/api/payment', paymentRoutes);
app.use('/api/collection', collectionRoutes);
// Server-rendered link previews (Open Graph) for social scrapers.
app.use('/share', shareRoutes);
app.get('/api/wakeup', (req, res) => {
  res.json({ message: 'Server is awake and ready.' });
});

// error handler (must keep 4 args for Express to treat it as one)
app.use((err, req, res, next) => {
  if (err && err.message === 'Not allowed by CORS') {
    return res
      .status(403)
      .json({ error: 'Origin not allowed', origin: req.headers.origin });
  }
  console.error('Unhandled error:', err);
  return res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

export default app;

// connect to db
let server;
console.log('NODE_ENV:', process.env.NODE_ENV);

// Test environment - don't auto-connect or start server
if (process.env.NODE_ENV === 'test') {
  console.log(
    'Test environment detected - database connection will be handled by tests'
  );
}
// Development environment
else if (process.env.NODE_ENV === 'development') {
  mongoose
    .connect(process.env.MONGO_LOCAL_URI)
    .then(() => {
      // listen for requests
      server = app.listen(process.env.PORT, () => {
        console.log(
          `connected to db & listening on  ,${process.env.PROTOCOL}://${process.env.HOST}:${process.env.PORT}`
        );
      });
    })
    .catch((err) => {
      console.log('Error:', err);
    });
}
// Production environment
else {
  mongoose
    //.connect(process.env.MONGO_LOCAL_URI)
    .connect(process.env.MONGO_URI)
    .then(() => {
      // listen for requests
      server = app.listen(process.env.PORT, () => {
        console.log(
          `connected to db & listening on  ,${process.env.PROTOCOL}://${process.env.HOST}:${process.env.PORT}`
        );
      });
    })
    .catch((err) => {
      console.log('Error:', err);
    });
}
export { app, mongoose, server };
