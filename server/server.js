import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './db.js';
import {
  signup, login, createSession, destroySession, getSessionUser, getSession, extendSession,
  changePassword, deleteAccount,
  changeUsername, setEmail, clearEmail,
  findOrCreateGoogleUser, linkGoogleToUser, unlinkGoogleFromUser,
  isValidUsername, isValidEmail, normalizeUsername,
  SESSION_MS,
} from './auth.js';
import * as google from './google.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

// ---- cookie parsing ----
app.use((req, _res, next) => {
  req.cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent))
      .filter(([k]) => k)
  );
  next();
});

const cookieFlags = `HttpOnly; SameSite=Lax; Path=/${PROD ? '; Secure' : ''}`;
const SESSION_MAX_AGE_S = Math.floor(SESSION_MS / 1000);
const setSessionCookie = (res, id) => res.append('Set-Cookie', `session=${id}; ${cookieFlags}; Max-Age=${SESSION_MAX_AGE_S}`);
const clearSessionCookie = (res) => res.append('Set-Cookie', `session=; ${cookieFlags}; Max-Age=0`);
const setOauthStateCookie = (res, state) => res.append('Set-Cookie', `oauth_state=${state}; ${cookieFlags}; Max-Age=600`);
const clearOauthStateCookie = (res) => res.append('Set-Cookie', `oauth_state=; ${cookieFlags}; Max-Age=0`);

// ---- rate limiter ----
const attempts = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 10;
  const list = (attempts.get(ip) || []).filter(t => now - t < windowMs);
  if (list.length >= max) return res.status(429).json({ error: 'too many attempts, try again later' });
  list.push(now);
  attempts.set(ip, list);
  next();
}
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [ip, list] of attempts) {
    const fresh = list.filter(t => t > cutoff);
    if (fresh.length === 0) attempts.delete(ip);
    else attempts.set(ip, fresh);
  }
}, 10 * 60 * 1000).unref();

// ---- auth gate ----
async function requireUser(req, res, next) {
  const user = await getSessionUser(req.cookies.session);
  if (!user) return res.status(401).json({ error: 'not logged in' });
  req.user = user;
  next();
}

const publicUser = (u) => u && {
  username: u.username,
  email: u.email || null,
  hasPassword: !!u.password_hash,
  hasGoogle: !!u.google_id,
};

// ===== auth =====
app.post('/api/signup', rateLimit, async (req, res) => {
  const { username, password } = req.body || {};
  const u = normalizeUsername(username);
  if (!isValidUsername(u)) return res.status(400).json({ error: 'username must be 3–30 chars (letters, numbers, _.-)' });
  if (!password || password.length < 8) return res.status(400).json({ error: '8+ character password required' });
  try {
    const userId = await signup(u, password);
    setSessionCookie(res, (await createSession(userId)).id);
    res.json({ ok: true });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'username already taken' });
    throw e;
  }
});

app.post('/api/login', rateLimit, async (req, res) => {
  const { username, password } = req.body || {};
  const user = await login(normalizeUsername(username), password || '');
  if (!user) return res.status(401).json({ error: 'wrong username or password' });
  setSessionCookie(res, (await createSession(user.id)).id);
  res.json({ ok: true });
});

app.post('/api/logout', async (req, res) => {
  await destroySession(req.cookies.session);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  res.json({ user: publicUser(await getSessionUser(req.cookies.session)) });
});

app.get('/api/session', async (req, res) => {
  const session = await getSession(req.cookies.session);
  res.json({ expiresAt: session ? session.expires_at : null });
});

app.post('/api/session/extend', async (req, res) => {
  const expiresAt = await extendSession(req.cookies.session);
  if (!expiresAt) return res.status(401).json({ error: 'not logged in' });
  setSessionCookie(res, req.cookies.session);
  res.json({ expiresAt });
});

// ===== account =====
app.post('/api/account/username', requireUser, async (req, res) => {
  const u = normalizeUsername(req.body?.username);
  if (!isValidUsername(u)) return res.status(400).json({ error: 'invalid username' });
  if (u === req.user.username) return res.json({ ok: true });
  if (!(await changeUsername(req.user.id, u))) return res.status(409).json({ error: 'username already taken' });
  res.json({ ok: true });
});

app.post('/api/account/email', requireUser, async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  if (!email) { await clearEmail(req.user.id); return res.json({ ok: true }); }
  if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid email' });
  if (!(await setEmail(req.user.id, email))) return res.status(409).json({ error: 'email already in use' });
  res.json({ ok: true });
});

app.post('/api/account/password', requireUser, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: '8+ character new password required' });
  const ok = await changePassword(req.user.id, currentPassword, newPassword);
  if (!ok) return res.status(401).json({ error: 'current password is wrong' });
  // password change invalidates sessions; force re-login
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.delete('/api/account', requireUser, async (req, res) => {
  const ok = await deleteAccount(req.user.id, req.body?.password);
  if (!ok) return res.status(401).json({ error: 'wrong password' });
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/account/google/unlink', requireUser, async (req, res) => {
  const ok = await unlinkGoogleFromUser(req.user.id);
  if (!ok) return res.status(400).json({ error: 'set a password before unlinking Google' });
  res.json({ ok: true });
});

// ===== google oauth =====
app.get('/api/auth/google/start', async (req, res) => {
  if (!google.isConfigured()) return res.status(501).send('Google OAuth not configured');
  const linking = !!(await getSessionUser(req.cookies.session)) && req.query.link === '1';
  const { url, state } = google.buildAuthUrl({ linking });
  setOauthStateCookie(res, state);
  res.redirect(url);
});

app.get('/api/auth/google/callback', async (req, res) => {
  if (!google.isConfigured()) return res.status(501).send('Google OAuth not configured');
  const { code, state, error } = req.query;
  const expected = req.cookies.oauth_state;
  clearOauthStateCookie(res);

  if (error) return res.redirect(`/account.html?google_error=${encodeURIComponent(String(error))}`);
  if (!code || !state || state !== expected) {
    return res.redirect('/account.html?google_error=bad_state');
  }

  try {
    const profile = await google.exchangeCodeForProfile(code);
    const linking = google.isLinkingState(state);

    if (linking) {
      const currentUser = await getSessionUser(req.cookies.session);
      if (!currentUser) return res.redirect('/account.html?google_error=session_lost');
      const ok = await linkGoogleToUser(currentUser.id, profile.googleId);
      if (!ok) return res.redirect('/account.html?google_error=already_linked');
      return res.redirect('/account.html?google_linked=1');
    }

    // login or signup
    const user = await findOrCreateGoogleUser({
      googleId: profile.googleId,
      email: profile.email,
      suggestedUsername: profile.email ? profile.email.split('@')[0] : profile.name,
    });
    setSessionCookie(res, (await createSession(user.id)).id);
    res.redirect('/');
  } catch (e) {
    console.error('google oauth error:', e);
    res.redirect('/account.html?google_error=exchange_failed');
  }
});

// ===== grademap =====
app.get('/api/grademap', requireUser, async (req, res) => {
  const row = await db.get('SELECT data, updated_at FROM grademaps WHERE user_id = ?', [req.user.id]);
  res.json(row ? { data: JSON.parse(row.data), updated_at: row.updated_at } : { data: null });
});

app.put('/api/grademap', requireUser, async (req, res) => {
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'bad body' });
  await db.run(
    `INSERT INTO grademaps (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [req.user.id, JSON.stringify(req.body), Date.now()],
  );
  res.json({ ok: true });
});

app.delete('/api/grademap', requireUser, async (req, res) => {
  await db.run('DELETE FROM grademaps WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
});

// ===== static + errors =====
app.use(express.static(ROOT, { extensions: ['html'] }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
