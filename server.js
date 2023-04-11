require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const userRoutes = require('./routes/user');
const authRoutes = require('./routes/auth')
const cors = require('cors');

//express app
const app = express();


//middleware 
app.use(express.json())
app.use(cors());
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use((req, res, next) => {
  console.log(req.path, req.method);
  next();

})

//routes
app.use('/api/user', userRoutes);
app.use('/api/auth', authRoutes)


// connect to db 
mongoose.connect(process.env.MONGO_LOCAL_URI).then(() => {

  // listen for requests
  app.listen(process.env.PORT, () => {
    console.log('connected to db & listening on port ', process.env.PORT)
  })

}).catch(err => {
  console.log(err)
})



process.env