export function canJoinRoom(user, room, membership) {
  if (!user?._id || !room?._id) return false
  const userId = String(user._id)
  if (user.role === 'teacher') return String(room.teacher?._id || room.teacher) === userId
  return user.role === 'student' && Boolean(membership)
}

export function createSocketAuthMiddleware({ jwt, getSecret, User }) {
  return async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
      if (!token) return next(new Error('Authentication required'))
      const decoded = jwt.verify(token, getSecret())
      const user = await User.findById(decoded.userId).select('-password')
      if (!user) return next(new Error('Invalid authentication'))
      socket.userId = String(user._id)
      socket.user = user
      next()
    } catch (error) {
      const authError = new Error(error.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid authentication')
      authError.data = { expired: error.name === 'TokenExpiredError' }
      next(authError)
    }
  }
}

export async function authorizeSocketRoom({ user, userId, roomCode, Room, RoomMember }) {
  if (!user?._id || !roomCode) return null
  const room = await Room.findByCode(roomCode)
  if (!room) return null
  const membership = user.role === 'student'
    ? await RoomMember.findOne({ roomId: room._id, studentId: userId })
    : null
  return canJoinRoom(user, room, membership) ? room : null
}
