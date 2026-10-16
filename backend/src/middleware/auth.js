import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import User from '../models/User.js'
import { getJwtSecret } from '../utils/productionConfig.js'

const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d'

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please provide a valid token' 
      })
    }

    const token = authHeader.split(' ')[1]
    
    const decoded = jwt.verify(token, getJwtSecret())
    
    const user = await User.findById(decoded.userId).select('-password')
    
    if (!user) {
      return res.status(401).json({ 
        error: 'User not found',
        message: 'The user associated with this token no longer exists' 
      })
    }

    req.user = user
    next()
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'The provided token is invalid or expired' 
      })
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired',
        message: 'Your session has expired. Please sign in again' 
      })
    }
    next(error)
  }
}

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Not authenticated',
        message: 'Please sign in to access this resource' 
      })
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You do not have permission to perform this action' 
      })
    }

    next()
  }
}

export const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    getJwtSecret(),
    { expiresIn: JWT_EXPIRY }
  )
}
