// Decoded JWT set by JwtAuthGuard (was req.user from verifyToken).
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role?: string; email?: string; phoneNumber?: string; [key: string]: any };
    }
  }
}

export {};
