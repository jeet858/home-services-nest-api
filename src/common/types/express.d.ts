// Decoded JWT set by JwtAuthGuard (was req.user from verifyToken), or by ProviderGuard for partner routes.
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role?: string; email?: string; phoneNumber?: string; [key: string]: any };
      provider?: { id: string; phoneNumber?: string };
    }
  }
}

export {};
