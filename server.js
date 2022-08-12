require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const userRoutes = require('./routes/user');
const authRoutes = require('./routes/auth')


//express app
const app = express();


//middleware 
app.use(express.json())


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