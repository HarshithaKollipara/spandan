import { authorizeSocketRoom, canJoinRoom, createSocketAuthMiddleware } from '../utils/socketAuthorization.js'

describe('Socket.IO authentication and room authorization', () => {
  test('rejects sockets without a handshake token and accepts valid users', async () => {
    const user = { _id: 'student-1', role: 'student' }
    const User = { findById: jest.fn(() => ({ select: jest.fn().mockResolvedValue(user) })) }
    const jwt = { verify: jest.fn((token) => ({ userId: token })) }
    const middleware = createSocketAuthMiddleware({ jwt, getSecret: () => 'test-secret', User })
    const socket = { handshake: { auth: {} } }
    const denied = jest.fn()
    await middleware(socket, denied)
    expect(denied.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(User.findById).not.toHaveBeenCalled()

    socket.handshake.auth.token = 'student-1'
    const accepted = jest.fn()
    await middleware(socket, accepted)
    expect(accepted).toHaveBeenCalledWith()
    expect(socket.userId).toBe('student-1')
    expect(socket.user).toBe(user)
  })

  test('rejects invalid tokens and expired tokens with an expiry marker', async () => {
    const middleware = createSocketAuthMiddleware({
      jwt: { verify: () => { throw Object.assign(new Error('expired'), { name: 'TokenExpiredError' }) } },
      getSecret: () => 'test-secret',
      User: {}
    })
    const next = jest.fn()
    await middleware({ handshake: { auth: { token: 'expired' } } }, next)
    expect(next.mock.calls[0][0].message).toBe('Token expired')
    expect(next.mock.calls[0][0].data.expired).toBe(true)
  })

  test('permits only room owners and existing student members', async () => {
    const room = { _id: 'room-1', teacher: 'teacher-1' }
    const otherRoom = { _id: 'room-2', teacher: 'teacher-2' }
    const Room = { findByCode: jest.fn(code => Promise.resolve(code === 'ABC123' ? room : otherRoom)) }
    const RoomMember = { findOne: jest.fn(({ roomId, studentId }) => Promise.resolve(
      roomId === room._id && studentId === 'student-1' ? { studentId } : null
    )) }
    expect(canJoinRoom({ _id: 'teacher-1', role: 'teacher' }, room, null)).toBe(true)
    expect(canJoinRoom({ _id: 'other-teacher', role: 'teacher' }, room, null)).toBe(false)
    expect(canJoinRoom({ _id: 'student-1', role: 'student' }, room, { studentId: 'student-1' })).toBe(true)
    expect(canJoinRoom({ _id: 'stranger', role: 'student' }, room, null)).toBe(false)
    await expect(authorizeSocketRoom({ user: { _id: 'teacher-1', role: 'teacher' }, userId: 'teacher-1', roomCode: 'ABC123', Room, RoomMember })).resolves.toBe(room)
    await expect(authorizeSocketRoom({ user: { _id: 'student-1', role: 'student' }, userId: 'student-1', roomCode: 'ABC123', Room, RoomMember })).resolves.toBe(room)
    await expect(authorizeSocketRoom({ user: { _id: 'student-1', role: 'student' }, userId: 'student-1', roomCode: 'XYZ789', Room, RoomMember })).resolves.toBeNull()
    await expect(authorizeSocketRoom({ user: { _id: 'teacher-1', role: 'teacher' }, userId: 'teacher-1', roomCode: 'XYZ789', Room, RoomMember })).resolves.toBeNull()
  })
})
