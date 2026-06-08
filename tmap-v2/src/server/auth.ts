import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { findUserById, type UserRecord } from './db.js';

function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET missing or too short — set a long random value in .env');
  }
  return s;
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, jwtSecret(), { expiresIn: '7d' });
}

export interface AuthedRequest extends Request {
  user?: UserRecord;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'missing bearer token' });
    return;
  }
  try {
    const payload = jwt.verify(token, jwtSecret()) as { sub: string };
    const user = findUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: 'user not found' });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'invalid or expired token' });
  }
}
