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
import cors from 'cors';

dotenv.config();

//express app
const app = express();

//middleware
app.use(express.json());
const corsOptions = {
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};
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
app.get('/api/wakeup', (req, res) => {
  res.json({ message: 'Server is awake and ready.' });
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
