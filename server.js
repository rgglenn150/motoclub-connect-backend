import dotenv from 'dotenv';
import express from 'express';
import session from 'express-session';
import mongoose from 'mongoose';
import userRoutes from './routes/user.js';
import authRoutes from './routes/auth.js';
import clubRoutes from './routes/club.js';
import eventRoutes from './routes/event.js';
import cors from 'cors';

dotenv.config();

//express app
const app = express();

//middleware
app.use(express.json());
app.use(cors());
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
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
app.get('/api/wakeup', (req, res) => {
  res.json({ message: 'Server is awake and ready.' });
});


export default app;

// connect to db
let server;
if (process.env.NODE_ENV !== 'test') {
 
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

export {
  app,
  mongoose,
  server
};