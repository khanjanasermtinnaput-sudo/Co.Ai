import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { findUserById, type UserRecord } from './db.js';

function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('JWT_SECRET missing or too short');
  return s;
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, jwtSecret(), { expiresIn: '30d' });
}

export interface AuthedRequest extends Request {
  user?: UserRecord;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) { res.status(401).json({ error: 'missing token' }); return; }
  try {
    const payload = jwt.verify(token, jwtSecret()) as { sub: string };
    findUserById(payload.sub).then((user) => {
      if (!user) { res.status(401).json({ error: 'user not found' }); return; }
      req.user = user; next();
    }).catch(() => res.status(401).json({ error: 'auth error' }));
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}
