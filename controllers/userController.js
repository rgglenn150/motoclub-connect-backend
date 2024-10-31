const User = require('../models/UserModel')

//get users

//register user DO NOT USE.  
/* const createUser = async (req, res) => {
  const {
    firstName,
    lastName,
    age
  } = req.body;
  try {
    const user = await User.create({
      firstName,
      lastName,
      age
    });
    res.status(200).send(user)
  } catch (error) {
    console.log(error);
    res.status(400).send({
      error: error.message
    })
  }

} */

const getUser = (req, res) => {
  res.json({
    message: 'Get all user '
  })
}



module.exports = {
  getUser
}