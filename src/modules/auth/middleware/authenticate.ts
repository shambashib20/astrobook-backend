import { ForbiddenError, UnauthorizedError } from '@/core/errors'
import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * Middleware to verify JWT access token.
 * Attaches decoded user payload to request.user
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch (_error) {
    throw UnauthorizedError('Invalid or expired token')
  }
}

/**
 * Public routes ke liye jahan login optional hai, lekin agar token diya
 * gaya ho toh request.user populate ho jaaye (jaise: feed mein isLikedByMe
 * dikhane ke liye). Invalid/missing token pe REJECT nahi karta, bas
 * request.user undefined chhod deta hai.
 */
export async function optionalAuthenticate(request: FastifyRequest, _reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch (_error) {
    // Token nahi diya ya invalid hai — koi baat nahi, guest ke taur pe continue karo
  }
}

/**
 * Role-based access control
 * Usage: { preHandler: [authenticate, requireRole(['admin', 'astrologer'])] }
 */
export function requireRole(allowedRoles: string[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = request.user as { userId: string; role: string; isOnboarded: boolean }

    if (!user || !allowedRoles.includes(user.role)) {
      throw ForbiddenError('Insufficient permissions')
    }
  }
}

/**
 * Require user to be onboarded
 */
export async function requireOnboarded(request: FastifyRequest, _reply: FastifyReply) {
  const user = request.user as { userId: string; role: string; isOnboarded: boolean }

  if (!user?.isOnboarded) {
    throw ForbiddenError('Please complete onboarding first')
  }
}
