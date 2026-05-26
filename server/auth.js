import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { db } from './db.js';

export const SESSION_MS = 10 * 60 * 1000;

// ---- validation ----
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,30}$/;
export const isValidUsername = (u) => typeof u === 'string' && USERNAME_RE.test(u);
export const normalizeUsername = (u) => String(u || '').trim().toLowerCase();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (e) => typeof e === 'string' && EMAIL_RE.test(e) && e.length <= 254;

// ---- lookups ----
export const findUserById = (id) =>
  db.get('SELECT id, username, email, google_id, password_hash, created_at FROM users WHERE id = ?', [id]);
export const findUserByUsername = (username) =>
  db.get('SELECT * FROM users WHERE username = ?', [username]);
const findUserByGoogleId = (googleId) =>
  db.get('SELECT * FROM users WHERE google_id = ?', [googleId]);
const findUserByEmail = (email) =>
  db.get('SELECT * FROM users WHERE email = ?', [email]);

// ---- password-based ----
export async function signup(username, password) {
  const password_hash = await hash(password);
  const info = await db.run(
    'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
    [username, password_hash, Date.now()],
  );
  return info.lastInsertRowid;
}

export async function login(username, password) {
  const user = await findUserByUsername(username);
  if (!user || !user.password_hash) return null;
  return (await verify(user.password_hash, password)) ? user : null;
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await findUserById(userId);
  if (!user) return false;
  if (user.password_hash) {
    if (!currentPassword || !(await verify(user.password_hash, currentPassword))) return false;
  }
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hash(newPassword), userId]);
  await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
  return true;
}

export async function deleteAccount(userId, password) {
  const user = await findUserById(userId);
  if (!user) return false;
  if (user.password_hash) {
    if (!password || !(await verify(user.password_hash, password))) return false;
  }
  await db.run('DELETE FROM users WHERE id = ?', [userId]);
  return true;
}

// ---- profile updates ----
export async function changeUsername(userId, newUsername) {
  try {
    await db.run('UPDATE users SET username = ? WHERE id = ?', [newUsername, userId]);
    return true;
  } catch (e) {
    if (String(e).includes('UNIQUE')) return false;
    throw e;
  }
}

export async function setEmail(userId, email) {
  try {
    await db.run('UPDATE users SET email = ? WHERE id = ?', [email, userId]);
    return true;
  } catch (e) {
    if (String(e).includes('UNIQUE')) return false;
    throw e;
  }
}

export async function clearEmail(userId) {
  await db.run('UPDATE users SET email = ? WHERE id = ?', [null, userId]);
}

// ---- google linking ----
export async function findOrCreateGoogleUser({ googleId, email, suggestedUsername }) {
  let user = await findUserByGoogleId(googleId);
  if (user) return user;

  if (email) {
    user = await findUserByEmail(email);
    if (user) {
      await db.run('UPDATE users SET google_id = ? WHERE id = ?', [googleId, user.id]);
      return findUserById(user.id);
    }
  }

  const username = await pickAvailableUsername(suggestedUsername);
  const info = await db.run(
    'INSERT INTO users (username, google_id, email, created_at) VALUES (?, ?, ?, ?)',
    [username, googleId, email || null, Date.now()],
  );
  return findUserById(info.lastInsertRowid);
}

export async function linkGoogleToUser(userId, googleId) {
  const existing = await findUserByGoogleId(googleId);
  if (existing && existing.id !== userId) return false;
  await db.run('UPDATE users SET google_id = ? WHERE id = ?', [googleId, userId]);
  return true;
}

export async function unlinkGoogleFromUser(userId) {
  const user = await findUserById(userId);
  if (!user) return false;
  if (!user.password_hash) return false;
  await db.run('UPDATE users SET google_id = ? WHERE id = ?', [null, userId]);
  return true;
}

async function pickAvailableUsername(seed) {
  const base = normalizeUsername(seed).replace(/[^a-z0-9_.-]/g, '').slice(0, 24) || 'user';
  if (!(await findUserByUsername(base))) return base;
  for (let i = 0; i < 50; i++) {
    const candidate = `${base}${randomBytes(2).toString('hex')}`;
    if (!(await findUserByUsername(candidate))) return candidate;
  }
  return `user_${randomBytes(6).toString('hex')}`;
}

// ---- sessions ----
export async function createSession(userId) {
  const id = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_MS;
  await db.run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [id, userId, expiresAt]);
  return { id, expiresAt };
}

export async function getSession(sessionId) {
  if (!sessionId) return null;
  const session = await db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    // Drop the dead row so it can't pile up between scheduled purges.
    await db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    return null;
  }
  return session;
}

// Periodic cleanup of expired sessions. Runs once on startup and every hour.
export async function purgeExpiredSessions() {
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
}
purgeExpiredSessions().catch((e) => console.error('initial session purge failed:', e));
setInterval(
  () => purgeExpiredSessions().catch((e) => console.error('session purge failed:', e)),
  60 * 60 * 1000,
).unref();

export async function getSessionUser(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return null;
  return findUserById(session.user_id);
}

export async function extendSession(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return null;
  const expiresAt = Date.now() + SESSION_MS;
  await db.run('UPDATE sessions SET expires_at = ? WHERE id = ?', [expiresAt, sessionId]);
  return expiresAt;
}

export async function destroySession(sessionId) {
  if (sessionId) await db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
}
