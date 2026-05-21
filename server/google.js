// Google OAuth 2.0 — standard authorization-code flow, no library.
// Docs: https://developers.google.com/identity/protocols/oauth2/web-server
import { randomBytes } from 'node:crypto';

const AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USER_URL  = 'https://www.googleapis.com/oauth2/v3/userinfo';

export const isConfigured = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const redirectUri = () => {
  const base = process.env.BASE_URL || 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api/auth/google/callback`;
};

// Caller stores the returned `state` in a short-lived cookie and compares on callback.
export function buildAuthUrl({ linking = false } = {}) {
  const state = randomBytes(16).toString('hex') + (linking ? '.link' : '.login');
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  });
  return { url: `${AUTH_URL}?${params}`, state };
}

export const isLinkingState = (state) => typeof state === 'string' && state.endsWith('.link');

export async function exchangeCodeForProfile(code) {
  // 1. Exchange the one-time code for an access token.
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  const { access_token } = await tokenRes.json();

  // 2. Use the access token to fetch the user's profile.
  const userRes = await fetch(USER_URL, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!userRes.ok) throw new Error(`userinfo failed: ${userRes.status}`);
  const profile = await userRes.json();
  // profile: { sub, email, email_verified, name, given_name, family_name, picture, locale }
  return {
    googleId: profile.sub,
    email: profile.email_verified ? profile.email : null,
    name: profile.name || profile.given_name || '',
  };
}
