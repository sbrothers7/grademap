// Account settings page logic.

const $ = (sel) => document.querySelector(sel);

function setMsg(forField, text, cls = '') {
    const el = document.querySelector(`.msg[data-for="${forField}"]`);
    if (!el) return;
    el.textContent = text;
    el.className = 'msg' + (cls ? ' ' + cls : '');
}

async function api(path, opts = {}) {
    const r = await fetch(path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    let body = {};
    try { body = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, body };
}

let me = null;

async function loadMe() {
    const { body } = await api('/api/me');
    me = body.user;

    if (!me) {
        document.getElementById('anon-state').classList.remove('hidden');
        document.getElementById('logged-in-state').classList.add('hidden');
        return;
    }

    $('#cur-username').value = me.username;
    $('#cur-email').value = me.email || '';

    // Password hint changes based on whether they already have one set
    $('#password-hint').textContent = me.hasPassword
        ? 'Change the password used to log in.'
        : 'You signed up with Google. Set a password to also enable username login.';
    $('#current-password').placeholder = me.hasPassword ? 'Current password' : '(no password set yet)';
    $('#current-password').disabled = !me.hasPassword;

    // Google card
    const linkBtn = $('#btn-link-google');
    if (me.hasGoogle) {
        $('#google-hint').textContent = 'Google is linked. You can sign in with Google or with your password.';
        $('#google-btn-label').textContent = 'Unlink Google';
        linkBtn.onclick = unlinkGoogle;
        if (!me.hasPassword) linkBtn.title = 'Set a password before unlinking, or you\'ll be locked out.';
    } else {
        $('#google-hint').textContent = 'Link your Google account to sign in without a password.';
        $('#google-btn-label').textContent = 'Link Google';
        linkBtn.onclick = () => { window.location.href = '/api/auth/google/start?link=1'; };
    }

    // Delete card — password field hint
    $('#delete-password').placeholder = me.hasPassword ? 'Password' : '(no password — leave empty)';
    $('#delete-password').disabled = !me.hasPassword;
}

// --- handle URL hints from OAuth callback ---
function showOauthFlash() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google_linked')) setMsg('google', 'Google linked successfully.', 'ok');
    const err = params.get('google_error');
    if (err) {
        const map = {
            bad_state: 'Session expired during sign-in — try again.',
            session_lost: 'You were logged out before linking finished.',
            already_linked: 'That Google account is already linked to a different user.',
            exchange_failed: 'Google sign-in failed. Try again.',
        };
        setMsg('google', map[err] || `Google error: ${err}`, 'error');
    }
    if (params.has('google_linked') || params.has('google_error')) {
        history.replaceState({}, '', '/account.html');
    }
}

// --- form handlers ---
$('#form-username').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#cur-username').value.trim();
    const { ok, body } = await api('/api/account/username', { method: 'POST', body: JSON.stringify({ username }) });
    if (!ok) return setMsg('username', body.error || 'failed', 'error');
    setMsg('username', 'Saved.', 'ok');
    await loadMe();
});

$('#form-email').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#cur-email').value.trim();
    const { ok, body } = await api('/api/account/email', { method: 'POST', body: JSON.stringify({ email }) });
    if (!ok) return setMsg('email', body.error || 'failed', 'error');
    setMsg('email', email ? 'Email saved.' : 'Email cleared.', 'ok');
    await loadMe();
});

$('#form-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = $('#current-password').value;
    const newPassword = $('#new-password').value;
    const { ok, body } = await api('/api/account/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!ok) return setMsg('password', body.error || 'failed', 'error');
    setMsg('password', 'Password updated. Log in again on this device.', 'ok');
    $('#current-password').value = '';
    $('#new-password').value = '';
    setTimeout(() => { window.location.href = '/'; }, 1500);
});

$('#form-delete').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm('Delete your account and all grade data? This cannot be undone.')) return;
    const password = $('#delete-password').value;
    const { ok, body } = await api('/api/account', {
        method: 'DELETE',
        body: JSON.stringify({ password }),
    });
    if (!ok) return setMsg('delete', body.error || 'failed', 'error');
    localStorage.removeItem('grademap');
    window.location.href = '/';
});

async function unlinkGoogle() {
    if (!confirm('Unlink your Google account?')) return;
    const { ok, body } = await api('/api/account/google/unlink', { method: 'POST' });
    if (!ok) return setMsg('google', body.error || 'failed', 'error');
    setMsg('google', 'Google unlinked.', 'ok');
    await loadMe();
}

// --- init ---
showOauthFlash();
loadMe();
