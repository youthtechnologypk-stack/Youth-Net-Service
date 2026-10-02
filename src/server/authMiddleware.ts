import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { JwtTokenPayload, SystemRole } from '../types/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'netpulse_carrier_grade_super_secret_jwt_key_2026';

// Extend Express Request interface to include authenticated user
export interface AuthenticatedRequest extends Request {
  user?: JwtTokenPayload;
}

/**
 * Generate a cryptographically signed HMAC-SHA256 JWT Token
 */
export function signJwtToken(payload: Omit<JwtTokenPayload, 'iat' | 'exp'>, expiresInSeconds: number = 3600): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtTokenPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  return `${b64Header}.${b64Payload}.${signature}`;
}

/**
 * Verify and decode HMAC-SHA256 JWT Token
 */
export function verifyJwtToken(token: string): JwtTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [b64Header, b64Payload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${b64Header}.${b64Payload}`)
      .digest('base64url');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }

    const payload: JwtTokenPayload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf-8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return null; // Expired token
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Middleware: Requires any valid authenticated user
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or malformed Bearer token.' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyJwtToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired JWT token.' });
  }

  req.user = decoded;
  next();
}

/**
 * Middleware: Role Guard - Strict Admin-only privilege
 */
export function isAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Forbidden: Admin privilege required to perform this action.',
        currentRole: req.user?.role,
      });
    }
    next();
  });
}

/**
 * Middleware: Flexible Role Guard allowing specified roles
 */
export function hasRole(allowedRoles: SystemRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    requireAuth(req, res, () => {
      if (!req.user || !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          error: `Forbidden: Requires one of [${allowedRoles.join(', ')}] role.`,
          currentRole: req.user?.role,
        });
      }
      next();
    });
  };
}
