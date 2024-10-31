
import jwt from 'jsonwebtoken';



const authMiddleware = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1]; // Expected format: "Bearer <token>"

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Attach decoded payload to req.user
    next(); // Proceed to the next middleware/route handler
  } catch (error) {
    res.status(403).json({ message: 'Invalid token.' });
  }
};

export default authMiddleware;
