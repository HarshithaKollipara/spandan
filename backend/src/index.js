import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { createServer } from 'http'
import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { getHealthStatus, getJwtSecret, validateProductionConfig } from './utils/productionConfig.js'
import { authorizeSocketRoom, createSocketAuthMiddleware } from './utils/socketAuthorization.js'
import User from './models/User.js'
import Room from './models/Room.js'
import RoomMember from './models/RoomMember.js'

// Import routes
import authRoutes from './routes/auth.js'
import roomRoutes from './routes/rooms.js'
import questionRoutes from './routes/questions.js'
import transcriptionRoutes from './routes/transcription.js'
import { initDiscussionForRoom, clearDiscussionForRoom } from './routes/transcription.js'
import transcriptRoutes from './routes/transcripts.js'
import discussionRoutes from './routes/discussion.js'
import responseRoutes from './routes/responses.js'

// Import models for reference
import './models/index.js'

dotenv.config()

const BASE_PATH = process.env.BASE_PATH || ''
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin
const CORS_ORIGINS = (process.env.CORS_ORIGINS || `${FRONTEND_ORIGIN},http://localhost:5173,http://localhost:3001`).split(',').map(s => s.trim())
const HTTP_CORS_ORIGINS = [...new Set([
  FRONTEND_ORIGIN,
  ...CORS_ORIGINS
])]

// Request timeout middleware - defined BEFORE use due to hoisting
const requestTimeout = (req, res, next) => {
  // Set a 30-second timeout for all requests
  req.setTimeout(30000, () => {
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timeout', message: 'The request took too long to process' })
    }
  })
  
  // Also set server-side timeout for the response
  res.setTimeout(30000, () => {
    if (!res.headersSent) {
      res.status(504).json({ error: 'Response timeout', message: 'The response took too long to generate' })
    }
  })
  
  next()
}

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Socket.IO polling)
      if (!origin) return callback(null, true)
      // Allow if origin is in the explicit CORS_ORIGINS list
      if (CORS_ORIGINS.includes(origin)) return callback(null, true)
      // Allow any localhost origin (covers localhost:5173, :8080, :3001, etc.)
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        return callback(null, true)
      }
      callback(new Error('Not allowed by CORS'))
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
})

// Make io accessible to routes
app.set('io', io)

// Trust proxy (for rate limiting behind nginx)
app.set('trust proxy', 1)

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // limit each IP to 2000 requests per windowMs (increased for real-time classroom use)
  message: { error: 'Too many requests, please try again later' }
})

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 300, // limit each IP to 300 auth requests per hour (increased for live classroom use)
  message: { error: 'Too many authentication attempts, please try again later' }
})

const responseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // limit each IP to 5000 response submissions per windowMs (high limit for live quizzes)
  message: { error: 'Too many response submissions, please try again later' }
})

const leaderboardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // very high limit for leaderboard reads (refreshes on every points update during live sessions)
  message: { error: 'Too many requests, please try again later' }
})

// Middleware
app.use(helmet())
app.use(cors({
  origin: HTTP_CORS_ORIGINS,
  credentials: true
}))
app.use(express.json({ limit: '10mb' }))
app.use('/api/', apiLimiter)           // general /api/ routes
app.use('/api/auth/', authLimiter)     // auth routes
app.use('/api/responses/', responseLimiter)  // response submission routes
app.use('/api/responses/leaderboard/', leaderboardLimiter)  // leaderboard routes (high limit for live sessions)

// Apply timeout middleware before routes
app.use(requestTimeout)

// API Routes
app.use('/api/auth', authRoutes)
app.use('/api/rooms', roomRoutes)
app.use('/api/questions', questionRoutes)
app.use('/api/transcription', transcriptionRoutes)
app.use('/api/transcripts', transcriptRoutes)
app.use('/api/discussion', discussionRoutes)
app.use('/api/responses', responseRoutes)

// Health check
app.get('/api/health', (req, res) => {
  const health = getHealthStatus(mongoose.connection.readyState)
  res.status(health.httpStatus).json({
    status: health.status,
    version: '0.5.0',
    timestamp: new Date().toISOString(),
    mongodb: health.mongodb
  })
})

// Socket.IO connection handling
const connectedUsers = new Map() // socket.id -> userId
const discussionState = new Map() // roomCode -> { discussionActive, pendingHands, approvedSpeakers }
const MAX_PENDING_HANDS = 5
const MAX_ACTIVE_SPEAKERS = 1

const getDiscussionState = (roomCode) => {
  if (!discussionState.has(roomCode)) {
    discussionState.set(roomCode, {
      discussionActive: false,
      pendingHands: [],
      approvedSpeakers: []
    })
  }
  return discussionState.get(roomCode)
}

const broadcastDiscussionState = (roomCode) => {
  const state = getDiscussionState(roomCode)
  io.to(roomCode).emit('discussion:update', state)
}

io.use(createSocketAuthMiddleware({ jwt, getSecret: getJwtSecret, User }))

const canAccessRoom = async (socket, roomCode) => {
  return authorizeSocketRoom({ user: socket.user, userId: socket.userId, roomCode, Room, RoomMember })
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id)
  connectedUsers.set(socket.id, socket.userId)

  // Authenticate socket
  socket.on('authenticate', (data) => {
    try {
      if (!data?.token) {
        socket.emit('authenticated', { success: false, error: 'No token provided' })
        return
      }
      const decoded = jwt.verify(data.token, getJwtSecret())
      socket.emit('authenticated', { success: String(decoded.userId) === socket.userId })
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        socket.emit('authenticated', { success: false, error: 'Token expired', expired: true })
      } else {
        socket.emit('authenticated', { success: false, error: 'Invalid token' })
      }
    }
  })

  // Join room
  socket.on('room:join', async ({ roomCode } = {}) => {
    try {
      const room = await canAccessRoom(socket, roomCode)
      if (!room) return socket.emit('room:join:error', { message: 'Access denied' })
      socket.join(roomCode)
      const participantCount = await RoomMember.countDocuments({ roomId: room._id })
      socket.emit('room:joined', { roomCode, userId: socket.userId, participants: participantCount })

      // Send current discussion state when a client joins the room
      const currentState = getDiscussionState(roomCode)
      socket.emit('discussion:update', currentState)
    } catch (error) {
      console.error('Error in room:join:', error)
      socket.emit('room:join:error', { message: 'Unable to join room' })
    }
  })

  // Leave room
  socket.on('room:leave', async ({ roomCode } = {}) => {
    try {
      const room = await canAccessRoom(socket, roomCode)
      if (!room || !socket.rooms.has(roomCode)) return
      socket.leave(roomCode)
      let participantCount = 0
      if (socket.user.role === 'student') {
        // Remove student from room members
        await RoomMember.deleteOne({ roomId: room._id, studentId: socket.userId })
        // Recount remaining participants
        participantCount = await RoomMember.countDocuments({ roomId: room._id })
      }
      io.to(roomCode).emit('room:left', { 
        roomCode,
        participants: participantCount 
      })
    } catch (error) {
      console.error('Error in room:leave:', error)
    }
  })

  // Submit response (real-time)
  socket.on('response:submit', (data) => {
    if (!socket.rooms.has(data?.roomCode) || socket.user.role !== 'student') return
    io.to(data.roomCode).emit('response:new', {
      questionId: data.questionId,
      studentId: socket.userId,
      selectedOption: data.selectedOption,
      responseTime: data.responseTime
    })
  })

  // Points update event (emitted after response is saved with calculated points)
  socket.on('points:update', (data) => {
    if (!socket.rooms.has(data?.roomCode) || socket.user.role !== 'student') return
    io.to(data.roomCode).emit('points:updated', {
      questionId: data.questionId,
      studentId: socket.userId,
      points: data.points,
      isCorrect: data.isCorrect
    })
  })

  // Question events
  socket.on('question:start', (data) => {
    if (!socket.rooms.has(data?.roomCode) || socket.user.role !== 'teacher') return
    io.to(data.roomCode).emit('question:started', {
      questionId: data.questionId,
      question: data.question,
      timer: data.timer,
      startTime: Date.now()
    })
  })

  socket.on('question:end', (data) => {
    if (!socket.rooms.has(data?.roomCode) || socket.user.role !== 'teacher') return
    io.to(data.roomCode).emit('question:ended', {
      questionId: data.questionId,
      results: data.results
    })
  })

  // New question from teacher (manually created)
  socket.on('new_question', (data) => {
    if (!socket.rooms.has(data?.roomCode) || socket.user.role !== 'teacher') return
    console.log('New question received from teacher:', data.question?.question?.substring(0, 50))
    const roomCode = data.roomCode
    const question = data.question
    if (roomCode && question) {
      io.to(roomCode).emit('new_question', question)
    } else {
      console.error('new_question event missing roomCode or question:', data)
    }
  })

  // Discussion workflow events
  socket.on('discussion:start', async (data) => {
    const { roomCode, token } = data
    if (!roomCode || !token) return
    try {
      const decoded = jwt.verify(token, getJwtSecret())
      const Room = (await import('./models/Room.js')).default
      const room = await Room.findByCode(roomCode)
      if (!room || room.teacher.toString() !== decoded.userId) return

      const state = getDiscussionState(roomCode)
      state.discussionActive = true
      state.pendingHands = []
      state.approvedSpeakers = []
      discussionState.set(roomCode, state)
      // Initialize a fresh in-memory discussion transcript for this room
      try {
        if (room && room._id) initDiscussionForRoom(String(room._id))
      } catch (e) {
        console.error('Failed to init discussion transcript for room:', e)
      }
      io.to(roomCode).emit('discussion:update', state)
    } catch (error) {
      console.error('discussion:start auth failed:', error.message)
    }
  })

  socket.on('discussion:end', async (data) => {
    const { roomCode, token } = data
    if (!roomCode || !token) return
    try {
      const decoded = jwt.verify(token, getJwtSecret())
      const Room = (await import('./models/Room.js')).default
      const room = await Room.findByCode(roomCode)
      if (!room || room.teacher.toString() !== decoded.userId) return

      const state = getDiscussionState(roomCode)
      state.discussionActive = false
      state.pendingHands = []
      state.approvedSpeakers = []
      discussionState.set(roomCode, state)
      // Clear in-memory discussion transcript for this room
      try {
        if (room && room._id) clearDiscussionForRoom(String(room._id))
      } catch (e) {
        console.error('Failed to clear discussion transcript for room:', e)
      }
      io.to(roomCode).emit('discussion:update', state)
    } catch (error) {
      console.error('discussion:end auth failed:', error.message)
    }
  })

  socket.on('discussion:raise-hand', async (data) => {
    const { roomCode, token } = data
    if (!roomCode || !token) return
    try {
      const decoded = jwt.verify(token, getJwtSecret())
      const User = (await import('./models/User.js')).default
      const user = await User.findById(decoded.userId)
      const Room = (await import('./models/Room.js')).default
      const room = await Room.findByCode(roomCode)
      const RoomMember = (await import('./models/RoomMember.js')).default
      const membership = await RoomMember.findOne({ roomId: room?._id, studentId: decoded.userId })

      if (!room || !user || user.role !== 'student' || !membership) return

      const state = getDiscussionState(roomCode)
      if (!state.discussionActive) return
      const alreadyPending = state.pendingHands.some(item =>
        (typeof item === 'string' ? item : item.studentId) === decoded.userId
      )
      const alreadyApproved = state.approvedSpeakers.some(item =>
        (typeof item === 'string' ? item : item.studentId) === decoded.userId
      )

      if (alreadyPending || alreadyApproved) return

      if (state.pendingHands.length >= MAX_PENDING_HANDS) {
        socket.emit('discussion:error', {
          success: false,
          reason: 'QUEUE_FULL',
          message: 'Discussion queue is full. Please wait.'
        })
        return
      }

      state.pendingHands.push({
        studentId: decoded.userId,
        studentName: user.name || 'Student'
      })
      discussionState.set(roomCode, state)
      io.to(roomCode).emit('discussion:update', state)
    } catch (error) {
      console.error('discussion:raise-hand auth failed:', error.message)
    }
  })

  socket.on('discussion:approve', async (data) => {
    const { roomCode, token } = data
    const userId = data.userId || data.studentId
    if (!roomCode || !userId || !token) return
    try {
      const decoded = jwt.verify(token, getJwtSecret())
      const Room = (await import('./models/Room.js')).default
      const room = await Room.findByCode(roomCode)
      if (!room || room.teacher.toString() !== decoded.userId) return

      const state = getDiscussionState(roomCode)
      if (!state.discussionActive) return

      if (state.approvedSpeakers.length >= MAX_ACTIVE_SPEAKERS) {
        socket.emit('discussion:error', {
          success: false,
          reason: 'ACTIVE_SPEAKER_LIMIT',
          message: 'Another student is currently speaking. Finish the current speaker first.'
        })
        return
      }

      const pendingStudent = state.pendingHands.find(item =>
        (typeof item === 'string' ? item : item.studentId) === userId
      )
      if (!pendingStudent) return

      let studentName = 'Student'
      if (pendingStudent && typeof pendingStudent === 'object' && pendingStudent.studentName) {
        studentName = pendingStudent.studentName
      } else {
        const User = (await import('./models/User.js')).default
        const studentUser = await User.findById(userId)
        if (studentUser && studentUser.name) {
          studentName = studentUser.name
        }
      }

      state.pendingHands = state.pendingHands.filter(item =>
        (typeof item === 'string' ? item : item.studentId) !== userId
      )

      const alreadyApproved = state.approvedSpeakers.some(item =>
        (typeof item === 'string' ? item : item.studentId) === userId
      )
      if (!alreadyApproved) {
        state.approvedSpeakers.push({
          studentId: userId,
          studentName
        })
      }
      discussionState.set(roomCode, state)
      io.to(roomCode).emit('discussion:update', state)
    } catch (error) {
      console.error('discussion:approve auth failed:', error.message)
    }
  })

  socket.on('discussion:reject', async (data) => {
    const { roomCode, token } = data
    const userId = data.userId || data.studentId
    if (!roomCode || !userId || !token) return
    try {
      const decoded = jwt.verify(token, getJwtSecret())
      const Room = (await import('./models/Room.js')).default
      const room = await Room.findByCode(roomCode)
      if (!room || room.teacher.toString() !== decoded.userId) return

      const state = getDiscussionState(roomCode)
      if (!state.discussionActive) return
      state.pendingHands = state.pendingHands.filter(item =>
        (typeof item === 'string' ? item : item.studentId) !== userId
      )
      discussionState.set(roomCode, state)
      io.to(roomCode).emit('discussion:update', state)
    } catch (error) {
      console.error('discussion:reject auth failed:', error.message)
    }
  })

  socket.on('discussion:remove-speaker', async (data) => {
    const { roomCode, token } = data
    const userId = data.userId || data.studentId
    if (!roomCode || !userId || !token) return
    try {
      const decoded = jwt.verify(token, getJwtSecret())
      const Room = (await import('./models/Room.js')).default
      const room = await Room.findByCode(roomCode)
      if (!room || room.teacher.toString() !== decoded.userId) return

      const state = getDiscussionState(roomCode)
      if (!state.discussionActive) return
      state.approvedSpeakers = state.approvedSpeakers.filter(item =>
        (typeof item === 'string' ? item : item.studentId) !== userId
      )
      discussionState.set(roomCode, state)
      io.to(roomCode).emit('discussion:update', state)
    } catch (error) {
      console.error('discussion:remove-speaker auth failed:', error.message)
    }
  })

  // Leaderboard update
  socket.on('leaderboard:update', (data) => {
    if (!socket.rooms.has(data?.roomCode) || socket.user.role !== 'teacher') return
    io.to(data.roomCode).emit('leaderboard:updated', data)
  })

  socket.on('disconnect', () => {
    const userId = connectedUsers.get(socket.id)
    connectedUsers.delete(socket.id)
    console.log('Client disconnected:', socket.id, userId ? `(user: ${userId})` : '')
  })
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err)
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  })
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' })
})

// MongoDB connection
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/spandan'
    
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    })
    
    console.log('MongoDB connected successfully')
  } catch (error) {
    console.error('MongoDB connection failed')
    if (process.env.NODE_ENV === 'production') throw error
    console.log('Server will continue without database connection')
  }
}

const PORT = process.env.PORT || 3001

// Start server
const startServer = async () => {
  validateProductionConfig()
  await connectDB()
  
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Spandan backend v0.5 running on port ${PORT}`)
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
  })
}

const redactStartupError = (value) => {
  let text = String(value || '')
  for (const [name, secret] of Object.entries(process.env)) {
    if (secret && secret.length >= 4 && /(secret|password|token|api[_-]?key|credential|uri)/i.test(name)) {
      text = text.replaceAll(secret, '[REDACTED]')
    }
  }
  return text
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, '[REDACTED_MONGODB_URI]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s:]+:[^/@\s]+@/gi, '$1[REDACTED]@')
    .replace(/((?:api[_-]?key|secret|password|token)\s*[=:]\s*)[^\s,;"'`]+/gi, '$1[REDACTED]')
}

startServer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('Backend startup failed:', redactStartupError(message))
  if (error instanceof Error && error.stack) {
    console.error(redactStartupError(error.stack))
  }
  process.exit(1)
})

export { app, io }
