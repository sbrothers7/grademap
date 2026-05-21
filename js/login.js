// Self-contained login/signup page. Redirects to / on success.

const $ = (sel) => document.querySelector(sel);
const tabs = document.querySelectorAll('.login-tab');
const submitBtn = $('#submit-btn');
const passwordInput = $('#password');
const hintEl = $('#password-hint');
const errEl = $('#auth-error');
const googleLabel = $('#google-label');

let mode = 'login';

function setMode(next) {
    mode = next;
    tabs.forEach(t => {
        const on = t.dataset.mode === mode;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
    });
    submitBtn.textContent = mode === 'login' ? 'Log in' : 'Sign up';
    passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    hintEl.textContent = mode === 'login' ? '' : '8+ characters.';
    googleLabel.textContent = mode === 'login' ? 'Continue with Google' : 'Sign up with Google';
    errEl.textContent = '';
}

tabs.forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));

// Surface a notice if we landed here from an auto-logout.
if (new URLSearchParams(location.search).get('expired') === '1') {
    const notice = $('#login-notice');
    notice.textContent = 'Your session expired and you were automatically logged out.';
    notice.classList.remove('hidden');
}

// If already logged in, bounce home.
(async () => {
    try {
        const r = await fetch('/api/me');
        const j = await r.json();
        if (j.user) window.location.replace('/');
    } catch {}
})();

$('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    const username = $('#username').value.trim();
    const password = passwordInput.value;
    const url = mode === 'login' ? '/api/login' : '/api/signup';

    submitBtn.disabled = true;
    try {
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
            errEl.textContent = j.error || 'failed';
            submitBtn.disabled = false;
            return;
        }
        window.location.replace('/');
    } catch {
        errEl.textContent = 'network error';
        submitBtn.disabled = false;
    }
});
