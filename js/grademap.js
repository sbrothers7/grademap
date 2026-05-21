// ===== state =====
// Shape:
// { subjects: [{ name, activeSem, s1: {formative:[], summative:[], finals:""}, s2: {...} }] }
const LS_KEY = 'grademap';
const state = { user: null, grademap: { subjects: [] } };

const blankSem = () => ({
    formative: ['', ''], summative: ['', ''], finals: '',
    target: '', targetCat: 'summative',
});
const blankSubject = () => ({
    name: '',
    activeSem: 's1',
    s1: blankSem(),
    s2: blankSem(),
});

// Auto-detect course type — name is the source of truth for subject type.
const CORE_NAMES = new Set([
    'english', 'geometry', 'algebra ii', 'algebra 2',
    'biology', 'chemistry', 'physics',
    'global studies', 'us history',
]);
function detectSubjectType(name) {
    const n = (name || '').trim().toLowerCase();
    if (!n) return 'elective';
    if (n.startsWith('ap ')) return 'ap';
    if (n === 'health and physical education') return 'pe';
    if (CORE_NAMES.has(n)) return 'core';
    return 'elective';
}
// Whether finals apply for this semester
function finalsApplies(type, sem) {
    if (type === 'core' || type === 'pe') return true;
    if (type === 'ap') return sem === 's1';
    return false; // electives
}
// Label for the "finals" slot — PE uses a Dragon Active assessment.
function finalsLabel(type) {
    return type === 'pe' ? 'Dragon Active' : 'Finals';
}
// Credits per subject — used to weight the overall percent and GPA.
const HALF_CREDIT = new Set(['korean language', 'korean social studies']);
function subjectCredits(name) {
    return HALF_CREDIT.has((name || '').trim().toLowerCase()) ? 0.5 : 1;
}

// ===== persistence =====
const saveLocal = () => localStorage.setItem(LS_KEY, JSON.stringify(state.grademap));
const loadLocal = () => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }
    catch { return null; }
};

let saveTimer = null;
function scheduleSave() {
    // While logged in, don't touch localStorage — it holds the anonymous
    // grademap and should survive a login/logout cycle untouched.
    if (!state.user) saveLocal();
    setStatus('saving…', 'saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(syncToServer, 600);
}

async function syncToServer() {
    if (!state.user) { setStatus('saved locally', ''); return; }
    try {
        const r = await fetch('/api/grademap', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.grademap),
        });
        if (!r.ok) throw new Error(`${r.status}`);
        setStatus('saved', '');
    } catch {
        setStatus('save failed (kept locally)', 'error');
    }
}

const setStatus = (text, cls) => {
    const el = document.getElementById('save-status');
    el.textContent = text;
    el.className = 'status' + (cls ? ' ' + cls : '');
};

// ===== auth =====
async function fetchMe() {
    try {
        const r = await fetch('/api/me');
        const j = await r.json();
        state.user = j.user;
    } catch { state.user = null; }
}

async function loadFromServer() {
    if (!state.user) return null;
    const r = await fetch('/api/grademap');
    if (!r.ok) return null;
    const j = await r.json();
    return j.data;
}

function loadInitialGrademap() {
    const local = loadLocal();
    return local && local.subjects?.length ? local : { subjects: [blankSubject()] };
}

// ===== account widget =====
function renderAccountWidget() {
    const w = document.getElementById('account-widget');
    if (state.user) {
        w.innerHTML = `
            <span id="session-timer" class="session-timer" title="Auto-logout countdown"></span>
            <button id="btn-extend" title="Extend session by 10 minutes">Extend</button>
            <a href="account.html" class="user-link" title="Account settings">@${escapeHtml(state.user.username)}</a>
            <button id="btn-logout">Log out</button>
        `;
        document.getElementById('btn-logout').onclick = logout;
        document.getElementById('btn-extend').onclick = extendSession;
        startSessionCountdown();
    } else {
        w.innerHTML = `<a href="login.html" class="login-link">Log in / Sign up</a>`;
        stopSessionCountdown();
    }
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    state.user = null;
    sessionExpiresAt = null;
    stopSessionCountdown();
    const local = loadLocal();
    state.grademap = local && local.subjects?.length ? local : { subjects: [blankSubject()] };
    renderAccountWidget();
    renderSubjects();
    setStatus('', '');
}

// ===== session countdown =====
let sessionExpiresAt = null;
let countdownTimer = null;

async function fetchSessionExpiry() {
    try {
        const r = await fetch('/api/session');
        const j = await r.json();
        sessionExpiresAt = j.expiresAt;
    } catch { sessionExpiresAt = null; }
}

async function extendSession() {
    try {
        const r = await fetch('/api/session/extend', { method: 'POST' });
        if (!r.ok) throw new Error();
        const j = await r.json();
        sessionExpiresAt = j.expiresAt;
        updateTimerDisplay();
    } catch {
        // session was already expired — force logout
        await logout();
    }
}

function startSessionCountdown() {
    stopSessionCountdown();
    updateTimerDisplay();
    countdownTimer = setInterval(updateTimerDisplay, 1000);
}

function stopSessionCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

function updateTimerDisplay() {
    const el = document.getElementById('session-timer');
    if (!el || !sessionExpiresAt) return;
    const remainingMs = sessionExpiresAt - Date.now();
    if (remainingMs <= 0) {
        stopSessionCountdown();
        el.textContent = '0:00';
        autoLogout();
        return;
    }
    const totalSec = Math.ceil(remainingMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el.classList.toggle('session-timer-warn', remainingMs < 60 * 1000);
}

async function autoLogout() {
    try { await fetch('/api/logout', { method: 'POST' }); } catch { }
    window.location.replace('/login.html?expired=1');
}

// ===== subject rendering =====
function renderSubjects({ loading = false, animate = false } = {}) {
    const list = document.getElementById('subjects-list');
    const tpl = document.getElementById('subject-template');
    list.innerHTML = '';

    state.grademap.subjects.forEach((subj, sIdx) => {
        const node = tpl.content.firstElementChild.cloneNode(true);
        if (loading) node.classList.add('loading');
        if (animate) node.classList.add('fade-fields');
        const nameEl = node.querySelector('.subject-name');
        const suggestionsEl = node.querySelector('.subject-suggestions');
        const badgeEl = node.querySelector('.subject-type-badge');

        nameEl.value = subj.name;
        updateBadge(badgeEl, detectSubjectType(subj.name));

        nameEl.addEventListener('input', () => {
            subj.name = nameEl.value;
            updateBadge(badgeEl, detectSubjectType(subj.name));
            renderActiveSemester(node, subj);
            renderSummary();
            scheduleSave();
        });

        setupSubjectAutocomplete(nameEl, suggestionsEl, (picked) => {
            nameEl.value = picked;
            subj.name = picked;
            updateBadge(badgeEl, detectSubjectType(picked));
            renderActiveSemester(node, subj);
            renderSummary();
            scheduleSave();
        });

        node.querySelector('.del-subject').onclick = () => {
            if (!confirm('Remove this subject?')) return;
            state.grademap.subjects.splice(sIdx, 1);
            if (state.grademap.subjects.length === 0) state.grademap.subjects.push(blankSubject());
            renderSubjects();
            scheduleSave();
        };

        // semester tabs
        node.querySelectorAll('.sem-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                subj.activeSem = tab.dataset.sem;
                renderActiveSemester(node, subj);
                scheduleSave();
            });
        });

        // add-score buttons (these target the currently-active semester)
        ['formative', 'summative'].forEach(cat => {
            const catEl = node.querySelector(`.category[data-cat="${cat}"]`);
            catEl.querySelector('.add-score').onclick = () => {
                const sem = subj[subj.activeSem];
                sem[cat].push('');
                renderScores(catEl, subj, cat, node);
                scheduleSave();
            };
        });

        // finals input
        node.querySelector('.finals-input').addEventListener('input', (e) => {
            subj[subj.activeSem].finals = e.target.value;
            recomputeSubject(node, subj);
            renderSummary();
            scheduleSave();
        });

        // target inputs (per active semester)
        node.querySelector('.target-input').addEventListener('input', (e) => {
            subj[subj.activeSem].target = e.target.value;
            recomputeTarget(node, subj);
            scheduleSave();
        });
        node.querySelector('.target-cat').addEventListener('change', (e) => {
            subj[subj.activeSem].targetCat = e.target.value;
            recomputeTarget(node, subj);
            scheduleSave();
        });

        renderActiveSemester(node, subj);
        list.appendChild(node);
    });

    renderSummary();
}

function updateBadge(badgeEl, type) {
    const labels = { core: 'Core', ap: 'AP', elective: 'Elective', pe: 'Elective' };
    badgeEl.textContent = labels[type];
    badgeEl.dataset.type = type;
}

function renderActiveSemester(node, subj) {
    const type = detectSubjectType(subj.name);
    const sem = subj.activeSem;

    // tabs visual state
    node.querySelectorAll('.sem-tab').forEach(tab => {
        const active = tab.dataset.sem === sem;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
    });

    // scores
    ['formative', 'summative'].forEach(cat => {
        const catEl = node.querySelector(`.category[data-cat="${cat}"]`);
        renderScores(catEl, subj, cat, node);
    });

    // finals visibility + note
    // Electives: hide the entire footer's finals UI (they never have finals).
    // AP S2: keep the row visible but disabled — same subject does have finals in S1.
    // Core / AP S1: enabled, optional.
    const showFinals = finalsApplies(type, sem);
    const finalsLbl = finalsLabel(type);
    const footer = node.querySelector('.subject-footer');
    const finalsBlock = node.querySelector('.finals-block');
    const finalsInput = node.querySelector('.finals-input');
    const finalsNote = node.querySelector('.finals-note');
    const finalsLabelEl = finalsBlock.querySelector('.cat-label');

    if (type === 'elective') {
        finalsBlock.classList.add('hidden');
        footer.classList.add('no-finals');
        finalsInput.value = '';
    } else {
        finalsBlock.classList.remove('hidden');
        footer.classList.remove('no-finals');
        finalsBlock.classList.toggle('disabled', !showFinals);
        finalsInput.disabled = !showFinals;
        finalsInput.value = showFinals ? (subj[sem].finals ?? '') : '';
        finalsLabelEl.textContent = finalsLbl;

        if (type === 'ap' && sem === 's2') finalsNote.textContent = '(no final in S2)';
        else if (type === 'core') finalsNote.textContent = '(optional)';
        else if (type === 'pe') finalsNote.textContent = '(required)';
        else finalsNote.textContent = '';
    }

    // target row: rebuild category options based on what applies, keep the current selection
    const targetInput = node.querySelector('.target-input');
    const targetCatSel = node.querySelector('.target-cat');
    targetInput.value = subj[sem].target ?? '';

    const validCats = ['formative', 'summative'];
    if (showFinals) validCats.push('finals');
    const catLabels = { formative: 'Formative', summative: 'Summative', finals: finalsLbl };
    targetCatSel.innerHTML = validCats.map(c =>
        `<option value="${c}">${catLabels[c]}</option>`
    ).join('');
    let currentCat = subj[sem].targetCat || 'summative';
    if (!validCats.includes(currentCat)) currentCat = 'summative';
    targetCatSel.value = currentCat;
    subj[sem].targetCat = currentCat;

    recomputeSubject(node, subj);
}

function renderScores(catEl, subj, cat, subjectNode) {
    const sem = subj[subj.activeSem];
    const scoresEl = catEl.querySelector('.scores');
    scoresEl.innerHTML = '';

    sem[cat].forEach((val, i) => {
        const cell = document.createElement('span');
        cell.className = 'score-cell';

        const input = document.createElement('input');
        input.type = 'number';
        input.min = 0; input.max = 100; input.step = 0.1;
        input.value = val;
        input.placeholder = '—';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-score';
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove score';
        removeBtn.setAttribute('aria-label', 'Remove score');

        const removeAt = () => {
            sem[cat].splice(i, 1);
            if (sem[cat].length === 0) sem[cat].push('');
            renderScores(catEl, subj, cat, subjectNode);
            recomputeSubject(subjectNode, subj);
            renderSummary();
            scheduleSave();
        };

        input.addEventListener('input', () => {
            sem[cat][i] = input.value;
            recomputeSubject(subjectNode, subj);
            renderSummary();
            scheduleSave();
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Backspace' && input.value === '' && sem[cat].length > 1) {
                e.preventDefault();
                removeAt();
            }
        });
        removeBtn.addEventListener('click', removeAt);

        cell.appendChild(input);
        cell.appendChild(removeBtn);
        scoresEl.appendChild(cell);
    });
}

// ===== calculation =====
const mean = (arr) => {
    const nums = (arr || []).map(parseFloat).filter(n => !Number.isNaN(n));
    if (!nums.length) return NaN;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
};

// Returns the percent grade for a single (subject, semester), or NaN if empty.
function semesterPercent(subj, semKey) {
    const sem = subj[semKey];
    if (!sem) return NaN;
    const f = mean(sem.formative);
    const s = mean(sem.summative);
    const fin = parseFloat(sem.finals);
    const hasF = !Number.isNaN(f), hasS = !Number.isNaN(s), hasFin = !Number.isNaN(fin);
    if (!hasF && !hasS && !hasFin) return NaN;

    const type = detectSubjectType(subj.name);
    const finalsAllowed = finalsApplies(type, semKey);

    if (type === 'elective') {
        // (20f + 80s) / 100, normalized to whichever categories are present
        return ((hasF ? f : 0) * 20 + (hasS ? s : 0) * 80) / ((hasF ? 20 : 0) + (hasS ? 80 : 0) || 1);
    }

    // core or AP
    if (finalsAllowed && hasFin) {
        // (20f + 60s + 20fin) / 100, normalized over present categories
        const num = (hasF ? f : 0) * 20 + (hasS ? s : 0) * 60 + fin * 20;
        const den = (hasF ? 20 : 0) + (hasS ? 60 : 0) + 20;
        return num / den;
    }
    // no-finals path: (20f + 60s) / 80
    const num = (hasF ? f : 0) * 20 + (hasS ? s : 0) * 60;
    const den = (hasF ? 20 : 0) + (hasS ? 60 : 0) || 1;
    return num / den;
}

// Returns the active weights map for a (subject, semester). Used by both
// the grade calc and the min-score solver, so they stay in sync.
// `assumeFinalsPresent`: if true and finals are allowed, include finals in
// the weights even if the score isn't entered yet (used when solving "min
// for finals").
function weightsFor(subj, semKey, { assumeFinalsPresent = false } = {}) {
    const type = detectSubjectType(subj.name);
    const finalsAllowed = finalsApplies(type, semKey);
    if (type === 'elective') return { formative: 20, summative: 80 };

    const finScore = parseFloat(subj[semKey].finals);
    const finalsInUse = finalsAllowed && (assumeFinalsPresent || !Number.isNaN(finScore));
    return finalsInUse
        ? { formative: 20, summative: 60, finals: 20 }
        : { formative: 20, summative: 60 };
}

// Parse the user's target input. Accepts "A-" / "B+" / "90" / "92.5".
// For letter grades, returns boundary - 0.5 so the rounding-based grader
// still maps the result to that letter (matches the KISJ rounding policy).
function parseTarget(raw) {
    const t = String(raw || '').trim();
    if (!t) return NaN;
    const asNum = parseFloat(t);
    if (!Number.isNaN(asNum) && /^[\d.]+$/.test(t)) return asNum;
    const letter = t.toUpperCase();
    const pct = letterToPercent(letter);
    if (Number.isNaN(pct)) return NaN;
    return pct - 0.5;
}

// Given a subject/semester, the target category, and desired percent,
// solve for the score needed in that category. Categories with no scores
// entered are dropped from the weights (matching how the actual grade is
// computed in semesterPercent), so e.g. requesting "min summative" works
// even when no formative scores are entered yet.
function minScoreFor(subj, semKey, targetCat, desired) {
    const sem = subj[semKey];
    const weights = weightsFor(subj, semKey, { assumeFinalsPresent: targetCat === 'finals' });
    if (!(targetCat in weights)) return NaN;

    const scoreFor = {
        formative: mean(sem.formative),
        summative: mean(sem.summative),
        finals: parseFloat(sem.finals),
    };

    // Drop unknown non-target categories from the weights.
    const activeWeights = { [targetCat]: weights[targetCat] };
    for (const cat of Object.keys(weights)) {
        if (cat === targetCat) continue;
        if (!Number.isNaN(scoreFor[cat])) activeWeights[cat] = weights[cat];
    }

    const totalWeight = Object.values(activeWeights).reduce((a, b) => a + b, 0);
    let knownSum = 0;
    for (const cat of Object.keys(activeWeights)) {
        if (cat === targetCat) continue;
        knownSum += activeWeights[cat] * scoreFor[cat];
    }
    return (desired * totalWeight - knownSum) / activeWeights[targetCat];
}

// Subject-level percent = average of the semesters that have data.
function subjectPercent(subj) {
    const ps = ['s1', 's2'].map(k => semesterPercent(subj, k)).filter(p => !Number.isNaN(p));
    if (!ps.length) return NaN;
    return ps.reduce((a, b) => a + b, 0) / ps.length;
}

function recomputeSubject(node, subj) {
    const sem = subj[subj.activeSem];
    const fAvg = mean(sem.formative);
    const sAvg = mean(sem.summative);
    node.querySelector('.category[data-cat="formative"] .cat-avg').textContent =
        Number.isNaN(fAvg) ? '' : fAvg.toFixed(1);
    node.querySelector('.category[data-cat="summative"] .cat-avg').textContent =
        Number.isNaN(sAvg) ? '' : sAvg.toFixed(1);

    const pct = semesterPercent(subj, subj.activeSem);
    const fg = node.querySelector('.final-grade');
    fg.classList.toggle('empty', Number.isNaN(pct));
    fg.textContent = Number.isNaN(pct) ? '—' : `${pct.toFixed(1)} (${percentToLetter(pct)})`;

    recomputeTarget(node, subj);
}

function recomputeTarget(node, subj) {
    const sem = subj.activeSem;
    const out = node.querySelector('.target-result');
    const desired = parseTarget(subj[sem].target);
    if (Number.isNaN(desired)) { out.textContent = '—'; out.classList.remove('warn'); out.classList.add('empty'); return; }
    out.classList.remove('empty');

    const cat = subj[sem].targetCat || 'summative';
    const requiredAvg = minScoreFor(subj, sem, cat, desired);
    if (Number.isNaN(requiredAvg)) {
        out.textContent = 'enter other scores';
        out.classList.remove('warn');
        return;
    }

    // Convert "category average needed" → "next single score needed",
    // given the scores already entered in that category.
    // Finals is a single value, so no transformation.
    let need = requiredAvg;
    if (cat !== 'finals') {
        const existing = (subj[sem][cat] || []).map(parseFloat).filter(v => !Number.isNaN(v));
        const sum = existing.reduce((a, b) => a + b, 0);
        need = requiredAvg * (existing.length + 1) - sum;
    }

    if (need > 100) {
        out.textContent = `${need.toFixed(1)} (impossible)`;
        out.classList.add('warn');
    } else if (need <= 0) {
        out.textContent = 'any score works';
        out.classList.remove('warn');
    } else {
        out.textContent = need.toFixed(1);
        out.classList.remove('warn');
    }
}

function renderSummary() {
    const subjects = state.grademap.subjects;

    // Credit-weighted aggregates. Korean Language and Korean Social Studies
    // count as 0.5 credits via subjectCredits().
    let pctSum = 0, pctCredits = 0;
    let unwSum = 0, wSum = 0, gpaCredits = 0;

    subjects.forEach(subj => {
        const pct = subjectPercent(subj);
        if (Number.isNaN(pct)) return;
        const credits = subjectCredits(subj.name);
        pctSum += pct * credits;
        pctCredits += credits;

        const pts = letterToPoint(percentToLetter(pct));
        if (Number.isNaN(pts)) return;
        const wPts = detectSubjectType(subj.name) === 'ap' ? pts + 1 : pts;
        unwSum += pts * credits;
        wSum += wPts * credits;
        gpaCredits += credits;
    });

    const overall = pctCredits ? pctSum / pctCredits : NaN;
    document.getElementById('overall-pct').textContent =
        Number.isNaN(overall) ? '—' : `${overall.toFixed(1)} (${percentToLetter(overall)})`;

    const setVal = (id, text, empty) => {
        const el = document.getElementById(id);
        el.classList.toggle('empty', !!empty);
        el.textContent = text;
    };
    const u = gpaCredits ? (unwSum / gpaCredits).toFixed(2) : null;
    const w = gpaCredits ? (wSum / gpaCredits).toFixed(2) : null;
    setVal('gpa-unweighted', u ?? '—', u === null);
    setVal('gpa-weighted', w ?? '—', w === null);
    document.getElementById('overall-pct').classList.toggle('empty', Number.isNaN(overall));
}

// ===== utilities =====
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== init =====
document.getElementById('add-subject').onclick = () => {
    state.grademap.subjects.push(blankSubject());
    renderSubjects();
    scheduleSave();
};

// ===== privacy mode =====
const PRIVACY_KEY = 'privacyMode';
function applyPrivacy(on) {
    document.body.classList.toggle('privacy-on', on);
    const cb = document.getElementById('privacy-toggle');
    if (cb) cb.checked = on;
}
document.getElementById('privacy-toggle').addEventListener('change', (e) => {
    localStorage.setItem(PRIVACY_KEY, String(e.target.checked));
    applyPrivacy(e.target.checked);
});
applyPrivacy(localStorage.getItem(PRIVACY_KEY) === 'true');

(async function init() {
    await fetchMe();
    if (state.user) await fetchSessionExpiry();
    renderAccountWidget();

    if (state.user) {
        // Phase 1: show a skeleton card while we wait for the server.
        state.grademap = { subjects: [blankSubject()] };
        renderSubjects({ loading: true });

        // Phase 2: real data → re-render with fields fading in.
        const server = await loadFromServer();
        if (server && server.subjects) {
            state.grademap = server;
        } else {
            const local = loadLocal();
            state.grademap = local && local.subjects?.length ? local : { subjects: [blankSubject()] };
            if (state.grademap.subjects.some(s => s.name)) await syncToServer();
        }
        renderSubjects({ animate: true });
    } else {
        // Logged out: nothing to fetch, render local data directly.
        state.grademap = loadInitialGrademap();
        renderSubjects();
    }
})();

// ===== custom subject autocomplete =====
// Lightweight replacement for <datalist>: shows a filtered dropdown only
// after the user types something, capped at MAX_MATCHES. Keyboard nav +
// click-to-select. SUBJECTS is defined in js/calc.js.
const MAX_MATCHES = 8;
function setupSubjectAutocomplete(input, listEl, onPick) {
    let matches = [];
    let active = -1;

    const close = () => {
        listEl.classList.add('hidden');
        listEl.innerHTML = '';
        matches = []; active = -1;
    };

    const render = () => {
        const q = input.value.trim().toLowerCase();
        if (!q) { close(); return; }
        matches = SUBJECTS.filter(s => s.toLowerCase().includes(q)).slice(0, MAX_MATCHES);
        if (matches.length === 0 || (matches.length === 1 && matches[0].toLowerCase() === q)) {
            close(); return;
        }
        active = -1;
        listEl.innerHTML = matches.map((m, i) =>
            `<li role="option" data-i="${i}">${escapeHtml(m)}</li>`
        ).join('');
        listEl.classList.remove('hidden');
    };

    const setActive = (i) => {
        const items = listEl.querySelectorAll('li');
        items.forEach((el, idx) => el.classList.toggle('active', idx === i));
        active = i;
    };

    const pick = (i) => {
        if (i < 0 || i >= matches.length) return;
        onPick(matches[i]);
        close();
    };

    input.addEventListener('input', render);
    input.addEventListener('focus', render);

    input.addEventListener('keydown', (e) => {
        if (listEl.classList.contains('hidden')) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((active + 1) % matches.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((active - 1 + matches.length) % matches.length);
        } else if (e.key === 'Enter') {
            if (active >= 0) { e.preventDefault(); pick(active); }
        } else if (e.key === 'Escape') {
            close();
        }
    });

    // mousedown (not click) so it fires before the input's blur closes us
    listEl.addEventListener('mousedown', (e) => {
        const li = e.target.closest('li');
        if (!li) return;
        e.preventDefault();
        pick(Number(li.dataset.i));
    });

    input.addEventListener('blur', () => {
        // delay so a mousedown on a li still registers
        setTimeout(close, 100);
    });
}
