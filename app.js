import { CONFIG } from './config.js';
import { icon, UI } from './icons.js';

/* =========================================================
   Ballot Match — app logic (no build step, no framework)
   ========================================================= */

const LIVE = !!(CONFIG.CIVIC_API_KEY && CONFIG.CIVIC_API_KEY.trim());
const OPTS = [[-2, 'Strongly disagree'], [-1, 'Disagree'], [0, 'Neutral'], [1, 'Agree'], [2, 'Strongly agree']];
const IMPS = [[1, 'Low'], [2, 'Medium'], [3, 'High']];
const WIDE = window.matchMedia('(min-width: 960px)');

let TOPICS = [], QUESTIONS = [], STANCES = {}, DEMO = null, BALLOTS = null, DENTON = null;
const DIST_KEYS = ['cd', 'hd', 'pct', 'jp'];

/* ---------- storage (answers never leave this device) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('bm:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bm:' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  clear() { try { Object.keys(localStorage).filter(k => k.startsWith('bm:')).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ } },
};
const S = {
  zip: store.get('zip', ''),
  address: store.get('address', ''),
  ballot: store.get('ballot', null),
  sel: store.get('sel', []),
  all: store.get('all', true),
  mode: store.get('mode', 'full'),
  ans: store.get('ans', {}),
  imp: store.get('imp', {}),
  dist: store.get('dist', { cd: '', hd: '', pct: '', jp: '' }),
  error: '',
  load: null, // { steps: [], step: 0 }
};
function save() { ['zip', 'address', 'ballot', 'sel', 'all', 'mode', 'ans', 'imp', 'dist'].forEach(k => store.set(k, S[k])); }

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = n => String(n).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const initials = n => String(n).split(/[\s-]+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const lower = s => s.charAt(0).toLowerCase() + s.slice(1);
const titleCase = s => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()) : s);
const joinAnd = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const fmtDate = d => { try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); } catch (e) { return d; } };
const qs = () => (S.mode === 'quick' ? QUESTIONS.filter(q => q.id % 2 === 0) : QUESTIONS);
const contests = () => (S.ballot ? S.ballot.contests : []);
const chosen = () => contests().map((c, i) => ({ ...c, i })).filter(c => S.sel.includes(c.i));
const record = c => STANCES[slug(c.name)] || null;

function stance(q, p) {
  if (p === null || p === undefined) return null;
  if (p === 0) return 'Mixed or moderate on ' + q.short;
  return p > 0 ? q.agree : q.disagree;
}

/* ---------- matching ---------- */
function evaluate(c) {
  const r = record(c);
  const out = { pct: null, n: 0, per: [], topic: TOPICS.map(() => null), rec: r };
  if (!r) return out;
  let num = 0, den = 0;
  const tn = TOPICS.map(() => 0), td = TOPICS.map(() => 0);
  qs().forEach(q => {
    const p = r.positions[q.id], a = S.ans[q.id];
    if (typeof a !== 'number' || p === null || p === undefined) return;
    const w = S.imp[q.id] || 2, ag = 1 - Math.abs(a - p) / 4;
    num += w * ag; den += w; out.n++;
    tn[q.topic] += w * ag; td[q.topic] += w;
    out.per.push({ q, ag, w, a, p });
  });
  out.pct = den ? Math.round(100 * num / den) : null;
  out.topic = tn.map((v, i) => (td[i] ? Math.round(100 * v / td[i]) : null));
  return out;
}

function scoreContest(ct) {
  const scored = ct.candidates.map((c, j) => ({ c, j, e: evaluate(c) }));
  scored.sort((a, b) => (b.e.pct ?? -1) - (a.e.pct ?? -1));
  const top = scored[0] && scored[0].e.pct !== null ? scored[0] : null;
  return { scored, top };
}

function explain(top, scored) {
  const { c, e } = top;
  const first = c.name.split(' ')[0];
  const good = e.per.filter(x => x.ag >= 0.75 && x.a !== 0)
    .sort((a, b) => (b.w * b.ag + Math.abs(b.a) * 0.01) - (a.w * a.ag + Math.abs(a.a) * 0.01));
  const seen = {}, hl = [];
  good.forEach(x => { if (hl.length < 3 && !seen[x.q.topic]) { seen[x.q.topic] = 1; hl.push({ topic: TOPICS[x.q.topic], text: stance(x.q, x.p) }); } });
  const bad = e.per.slice().sort((a, b) => (a.ag - b.ag) || (b.w - a.w))[0];
  let why = hl.length
    ? `You and ${first} line up most on ${joinAnd(hl.map(h => lower(h.topic)))}. `
    : `${first} is the closest overall fit, though no single issue is a strong match. `;
  why += (bad && bad.ag <= 0.5)
    ? `Your biggest difference is ${lower(TOPICS[bad.q.topic])}: ${first} ${lower(stance(bad.q, bad.p))}.`
    : 'There are no major disagreements on the issues you answered.';
  const tie = scored[1] && scored[1].e.pct !== null && scored[1].e.pct === e.pct;
  if (tie) why += ` ${scored[1].c.name} has the same score, so compare their profiles.`;
  return { why, hl };
}

/* ---------- live ballot (Google Civic Information API) ---------- */
function levelOf(levels) {
  const l = levels || [];
  if (l.includes('country')) return 'Federal';
  if (l.includes('administrativeArea1')) return 'State';
  return 'Local';
}
function friendly(msg) {
  if (/api key|referer|referrer|permission|forbidden|disabled|has not been used|blocked/i.test(msg)) return 'The app\u2019s API key isn\u2019t set up correctly. See "Turn on live ballots" in the README.';
  if (/parse address|address/i.test(msg)) return 'We couldn’t match that address. Check the street address and ZIP code.';
  if (/election unknown|no election/i.test(msg)) return 'Ballot information for the next election isn’t published for this address yet. Election officials usually release it a few weeks before Election Day.';
  if (/key|permission|referer|forbidden/i.test(msg)) return 'The app’s API key isn’t set up correctly. See "Turn on live ballots" in the README.';
  return 'We couldn’t load your ballot right now. Please try again in a moment.';
}
async function fetchLive() {
  const addr = [S.address.trim(), S.zip].filter(Boolean).join(', ');
  let url = 'https://www.googleapis.com/civicinfo/v2/voterinfo?key=' + encodeURIComponent(CONFIG.CIVIC_API_KEY.trim()) + '&address=' + encodeURIComponent(addr);
  if (CONFIG.ELECTION_ID) url += '&electionId=' + encodeURIComponent(CONFIG.ELECTION_ID);
  let res, data;
  try { res = await fetch(url); data = await res.json(); } catch (e) { throw new Error('We couldn’t reach the ballot service. Check your connection and try again.'); }
  if (!res.ok || data.error) { const raw = (data.error && data.error.message) || ('HTTP ' + res.status); const err = new Error(friendly(raw)); err.detail = raw; throw err; }
  const eab = data.state && data.state[0] && data.state[0].electionAdministrationBody || {};
  const links = [
    eab.votingLocationFinderUrl && { label: 'Find your polling place', url: eab.votingLocationFinderUrl },
    eab.electionRegistrationConfirmationUrl && eab.electionRegistrationConfirmationUrl !== eab.votingLocationFinderUrl && { label: 'Check your registration', url: eab.electionRegistrationConfirmationUrl },
    eab.ballotInfoUrl && { label: 'Official ballot information', url: eab.ballotInfoUrl },
  ].filter(Boolean);
  const order = { Federal: 0, State: 1, Local: 2 };
  const cts = (data.contests || [])
    .filter(c => c.type !== 'Referendum' && Array.isArray(c.candidates) && c.candidates.length)
    .map(c => ({
      office: titleCase(c.office || c.ballotTitle || 'Contest'),
      level: levelOf(c.level),
      district: c.district && c.district.name ? c.district.name : '',
      candidates: c.candidates.map(k => ({
        name: titleCase(k.name || 'Unnamed candidate'),
        party: k.party || 'No party listed',
        photoUrl: k.photoUrl || '',
        candidateUrl: k.candidateUrl || '',
        channels: k.channels || [],
      })),
    }))
    .sort((a, b) => order[a.level] - order[b.level]);
  if (!cts.length) {
    const err = new Error(S.address.trim()
      ? 'No candidate races were found for this address yet. Election officials usually publish ballots a few weeks before Election Day.'
      : 'ZIP codes can cross district lines, so we need your street address to find your exact ballot.');
    err.empty = true; err.links = links; err.election = data.election;
    throw err;
  }
  return { source: 'live', election: data.election || { name: 'Upcoming election' }, contests: cts, links };
}

/* Researched ballot (used when Google has no races for an address) */
function researchedFor(zip, fromErr) {
  if (!BALLOTS || !BALLOTS.zips || !BALLOTS.zips[zip]) return null;
  const b = JSON.parse(JSON.stringify(BALLOTS.ballots[BALLOTS.zips[zip]]));
  b.source = 'researched';
  if (fromErr && fromErr.election && fromErr.election.name) b.election = fromErr.election;
  if (fromErr && !fromErr.empty) b.notice = 'We couldn\u2019t reach Google\u2019s ballot service, so this is the ballot we researched for your area. ' + (b.notice || '');
  return b;
}

/* ---------- Denton County ballot from chosen districts ---------- */
function buildBallot() {
  const d = DENTON, order = { Federal: 0, State: 1, Local: 2 };
  const picked = [];
  ['cd', 'hd', 'pct'].forEach(k => { const o = d.districts[k].options[S.dist[k]]; if (o) picked.push(o); });
  const cts = JSON.parse(JSON.stringify([...d.statewide, ...picked])).sort((a, b) => order[a.level] - order[b.level]);
  const extras = JSON.parse(JSON.stringify(d.extras));
  const jp = d.districts.jp.info[S.dist.jp];
  if (jp) extras.unshift({ office: 'Justice of the Peace \u2014 Precinct ' + S.dist.jp, candidates: jp });
  const skipped = DIST_KEYS.filter(k => !S.dist[k]).map(k => d.districts[k].label);
  let notice = d.notice;
  if (skipped.length) notice += ' Not included because you weren\u2019t sure of your district: ' + joinAnd(skipped.map(lower)) + '. Look them up at votedenton.gov.';
  return { source: 'denton', election: d.election, contests: cts, extras, props: d.props, links: d.links, notice };
}

/* ---------- lookup flow ---------- */
function lookup(useDemo) {
  const steps = useDemo || !LIVE
    ? ['Loading the demo ballot', 'Matching candidates to stance records', 'Preparing your questions']
    : ['Finding your voting districts', 'Loading races and candidates from election officials’ data', 'Matching candidates to stance records', 'Preparing your questions'];
  S.load = { steps, step: 0 };
  S.error = ''; S.errorDetail = '';
  go('#/loading');
  const t0 = Date.now();
  const tick = setInterval(() => {
    if (S.load && S.load.step < S.load.steps.length - 1) { S.load.step++; if (route().name === 'loading') render(); }
  }, 550);
  const rb = !useDemo && !LIVE ? researchedFor(S.zip) : null;
  const work = useDemo ? Promise.resolve(JSON.parse(JSON.stringify(DEMO)))
    : rb ? Promise.resolve(rb)
    : !LIVE ? Promise.resolve(JSON.parse(JSON.stringify(DEMO)))
    : fetchLive().catch(err => { const b = researchedFor(S.zip, err); if (b) return b; throw err; });
  work.then(b => {
    const wait = Math.max(0, steps.length * 550 - (Date.now() - t0));
    setTimeout(() => {
      clearInterval(tick);
      S.ballot = b; S.sel = b.contests.map((_, i) => i); S.all = true; S.load = null;
      save(); go('#/races');
    }, wait);
  }).catch(err => {
    clearInterval(tick);
    S.load = null; S.error = err.message || String(err); S.errorDetail = err.detail || '';
    go('#/start');
  });
}

/* ---------- routing ---------- */
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, a, b] = h.split('/');
  return { name: name || 'start', a, b };
}
function go(hash) { if (location.hash === hash) render(true); else location.hash = hash; }

/* ---------- templates ---------- */
const footer = () => `
  <footer class="foot">
    <span style="flex-wrap:nowrap;align-items:flex-start">${icon('shield', 20)}<span>Ballot Match does not endorse candidates or parties. Your answers stay on this device.</span></span>
    <span>Confirm your sample ballot and polling place at <a href="https://www.votedenton.gov/" target="_blank" rel="noopener noreferrer">votedenton.gov</a>.${S.ballot ? ' <button type="button" class="linkbtn" data-act="restart" data-k="restart">Start over</button>' : ''}</span>
  </footer>`;

function photo(c, cls = '') {
  return `<div class="photo ${cls}" role="img" aria-label="${c.photoUrl ? 'Photo of ' + esc(c.name) : 'No photo available for ' + esc(c.name)}">${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}${c.photoUrl ? '' : esc(initials(c.name))}</div>`;
}

function viewStart() {
  const d = DENTON;
  const sel = (k) => {
    const def = d.districts[k];
    const ids = [...Object.keys(def.options), ...Object.keys(def.info || {}), ...(def.none || [])]
      .filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => (+a) - (+b));
    const word = k === 'cd' || k === 'hd' ? 'District' : 'Precinct';
    return `<div>
      <label class="field-label" for="d-${k}">${esc(def.label)}</label>
      <select class="field sm select" id="d-${k}" data-dist="${k}">
        <option value="">Not sure — skip this race</option>
        ${ids.map(id => `<option value="${id}" ${S.dist[k] === id ? 'selected' : ''}>${word} ${id}${(def.none || []).includes(id) ? ' (no race this year)' : ''}</option>`).join('')}
      </select>
    </div>`;
  };
  return `
  <div class="start-grid">
    <section class="hero">
      <div class="county-badge">${icon('map', 26)}<span>Denton County, Texas</span></div>
      <div class="row kicker" style="margin-top:14px">${icon('calendar', 28)}<span>General Election · Tuesday, Nov. 3, 2026</span></div>
      <h1>Find the Denton County candidates who share your values.</h1>
      <p class="lede">Choose your districts, answer questions on 12 issues, and see your closest match in every race on your Denton County ballot. Party labels stay hidden until your results.</p>
      <div class="pill-row"><span class="pill">${esc(d.election.earlyVoting)}</span><span class="pill">12 or 24 questions</span><span class="pill">No sign-up</span></div>
      <form class="form card" id="distform" novalidate>
        <div>
          <h2 class="serif" style="font-size:22px">Your districts</h2>
          <p class="muted" style="margin:4px 0 0;font-size:15px">Statewide and countywide races are the same for everyone. These four depend on where you live.</p>
        </div>
        <div class="preset-row">
          ${d.presets.map((p, i) => `<button type="button" class="btn ghost sm" data-act="preset" data-i="${i}" data-k="preset-${i}">${icon('pin', 22)}${esc(p.label)}</button>`).join('')}
          <a class="linkbtn" href="${esc(d.links[0].url)}" target="_blank" rel="noopener noreferrer">Look up my districts ${UI.ext}</a>
        </div>
        <div class="dist-grid">${DIST_KEYS.map(sel).join('')}</div>
        <button type="submit" class="btn red block" data-k="build">Build my ballot ${UI.next}</button>
      </form>
      <div id="ios-tip"></div>
    </section>
    <aside class="card top-navy">
      <h2 class="serif" style="font-size:22px;margin-bottom:16px">How matching works</h2>
      <ol class="how">
        <li>${icon('capitol', 40)}<span><strong>Pick your races.</strong> One race or every contested race on your Denton County ballot.</span></li>
        <li>${icon('bubbles', 40)}<span><strong>Answer 12 or 24 statements</strong> on the most divisive issues, and say how much each matters.</span></li>
        <li>${icon('award', 40)}<span><strong>See your closest match</strong> in each race, why, and how every other candidate compares.</span></li>
      </ol>
      <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--line)" class="stack">
        <span class="muted" style="font-size:14px">Races come from Denton County’s official contest list. Every stance links to its source, and no party is used to guess a position.</span>
        <a class="btn ghost block" href="#/about" data-k="about">${icon('doc', 24)}Behind the app: sources &amp; methodology</a>
      </div>
    </aside>
  </div>${footer()}`;
}

function viewLoading() {
  const L = S.load || { steps: [], step: 0 };
  return `
  <section class="card" style="max-width:640px;margin:0 auto">
    ${icon('map', 52)}
    <div class="kicker" style="margin-top:12px">${S.zip ? 'ZIP ' + esc(S.zip) : 'Demo ballot'}</div>
    <h1 class="page-h1" style="margin-bottom:22px" tabindex="-1">Building your ballot…</h1>
    <ul class="loadlist" aria-live="polite">
      ${L.steps.map((s, i) => `<li class="${i > L.step ? 'pending' : ''}"><span class="ld-icon">${i < L.step ? `<span class="ld-done">${UI.check}</span>` : i === L.step ? '<span class="spin" aria-hidden="true"></span>' : '<span class="ld-dot"></span>'}</span><span>${esc(s)}${i < L.step ? '<span class="sr"> (done)</span>' : ''}</span></li>`).join('')}
    </ul>
  </section>`;
}

function linksHtml(links) {
  if (!links || !links.length) return '';
  return `<div class="links">${links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ${UI.ext}</a>`).join('')}</div>`;
}
function extrasHtml(b) {
  if (!b || (!(b.extras || []).length && !(b.props || []).length)) return '';
  return `<details class="card extras">
    <summary><strong>Also on your ballot</strong> <span class="muted">\u2014 judges, other statewide offices and propositions</span></summary>
    <p class="muted" style="font-size:14px;margin:12px 0 4px">These races aren\u2019t matched to your answers. Judges don\u2019t campaign on policy positions, and we haven\u2019t researched the other offices yet.</p>
    <ul class="extra-list">${(b.extras || []).map(x => `<li><strong>${esc(x.office)}</strong><span>${esc(x.candidates)}</span></li>`).join('')}</ul>
    ${(b.props || []).map(pr => `<div class="notice" style="margin-top:12px;flex-direction:column;gap:4px"><strong>${esc(pr.title)}</strong><span>${esc(pr.text)}</span></div>`).join('')}
  </details>`;
}

function viewRaces() {
  const cts = contests();
  const el = S.ballot.election || {};
  const lvlIcon = { Federal: 'capitol', State: 'map', Local: 'people' };
  return `
  <div class="stack" style="gap:22px">
    <div>
      <div class="kicker">Your Denton County ballot · ${cts.length} matched races</div>
      <h1 class="page-h1" tabindex="-1">Which elections do you want matches for?</h1>
      ${el.name ? `<p class="muted" style="margin:8px 0 0">${esc(el.name)}${el.electionDay ? ' — ' + esc(fmtDate(el.electionDay)) : ''}</p>` : ''}
    </div>
    ${S.ballot.notice ? `<div class="notice">${icon('clipboard', 28)}<span>${esc(S.ballot.notice)}</span></div>` : ''}
    ${linksHtml(S.ballot.links)}
    <div class="card switch-row">
      <button type="button" class="switch" role="switch" aria-checked="${S.all}" data-act="all" data-k="all"><span class="track"><span class="knob"></span></span>All open elections</button>
      <span class="muted" style="font-size:14px">${S.sel.length} of ${cts.length}</span>
    </div>
    <div class="racelist">
      ${cts.map((c, i) => `
        <button type="button" class="race" aria-pressed="${S.sel.includes(i)}" data-act="race" data-i="${i}" data-k="race-${i}">
          <span class="box">${UI.check}</span>
          ${icon(lvlIcon[c.level], 36)}
          <span class="race-main"><span class="race-name">${esc(c.office)}</span><span class="race-meta">${c.district ? esc(c.district) + ' · ' : ''}${c.candidates.length} candidate${c.candidates.length === 1 ? '' : 's'}</span></span>
          <span class="lvl">${c.level}</span>
        </button>`).join('')}
    </div>
    <div class="card stack">
      <span style="font-weight:700">Question set</span>
      <div class="seg" role="group" aria-label="Question set">
        <button type="button" aria-pressed="${S.mode === 'quick'}" data-act="mode" data-v="quick" data-k="m-quick">Quick · 12</button>
        <button type="button" aria-pressed="${S.mode === 'full'}" data-act="mode" data-v="full" data-k="m-full">Thorough · 24</button>
      </div>
      <span class="muted" style="font-size:14px">Thorough gives more precise matches, especially in close races.</span>
    </div>
    ${extrasHtml(S.ballot)}
  </div>${footer()}`;
}

function viewQuiz(n) {
  const list = qs();
  const idx = Math.min(Math.max(0, n - 1), list.length - 1);
  const q = list[idx];
  const a = S.ans[q.id], w = S.imp[q.id] || 2;
  return `
  <div class="quiz" id="quiz">
    <div class="stack" style="gap:8px">
      <div class="qmeta"><span class="kicker">${esc(TOPICS[q.topic])}</span><span class="muted">${idx + 1} of ${list.length}</span></div>
      <div class="bar" role="progressbar" aria-label="Progress" aria-valuemin="1" aria-valuemax="${list.length}" aria-valuenow="${idx + 1}"><span style="width:${Math.round(100 * (idx + 1) / list.length)}%"></span></div>
    </div>
    <section class="card qcard">
      <div class="qprompt">${icon('bubbles', 30)}Do you agree or disagree?</div>
      <h1 class="qtext" tabindex="-1">“${esc(q.text)}”</h1>
      <div class="opts" role="group" aria-label="Your answer">
        ${OPTS.map(([v, l], i) => `<button type="button" class="opt" aria-pressed="${a === v}" data-act="ans" data-v="${v}" data-k="ans-${v}"><span class="dot"></span><span>${l}</span><span class="sr">(key ${i + 1})</span></button>`).join('')}
      </div>
      <div class="imp-row">
        <span class="imp-label" id="imp-l">${icon('scales', 28)}How much does this issue matter to you?</span>
        <div class="imp-btns" role="group" aria-labelledby="imp-l">
          ${IMPS.map(([v, l]) => `<button type="button" class="imp" aria-pressed="${w === v}" data-act="imp" data-v="${v}" data-k="imp-${v}">${l}</button>`).join('')}
        </div>
      </div>
    </section>
    <p class="swipe-hint">Tip: swipe left for the next question, right to go back.</p>
  </div>`;
}

function raceCard(ct, activeKey) {
  const { scored, top } = scoreContest(ct);
  const ratedCount = scored.filter(x => x.e.pct !== null).length;
  const anyRecord = scored.some(x => x.e.rec);
  let topHtml;
  if (top) {
    const { why, hl } = explain(top, scored);
    const c = top.c;
    topHtml = `
    <div class="top">
      <div class="top-id">
        ${photo(c)}
        <div style="flex:1;min-width:0">
          <span class="badge">${icon('award', 22)}${ratedCount > 1 ? 'Your closest match' : 'Only candidate we could score'}</span>
          <h3 class="cand-name">${esc(c.name)}</h3>
          <div class="cand-sub"><strong>${esc(c.party)}</strong>${c.role ? ' · ' + esc(c.role) : ''}</div>
          <div class="pct" style="margin-top:8px"><b>${top.e.pct}%</b><span>aligned with you</span></div>
        </div>
      </div>
      ${c.bio ? `<p style="margin:0">${esc(c.bio)}</p>` : ''}
      ${ratedCount > 1 ? '' : '<div class="notice warn">The other candidates in this race haven’t taken public positions on the issues you answered, so this score isn’t a head-to-head comparison.</div>'}
      <div class="why"><h3>Why this candidate</h3><p>${esc(why)}</p>${hl.length ? `<ul>${hl.map(h => `<li><strong>${esc(h.topic)}:</strong> ${esc(h.text)}</li>`).join('')}</ul>` : ''}</div>
      <span class="muted" style="font-size:13px">Compared on ${top.e.n} of your answers where ${esc(c.name.split(' ')[0])} has a public position.${top.e.rec && top.e.rec.demo ? ' Demo record.' : ''}</span>
      <a class="btn" href="#/c/${ct.i}/${top.j}" data-k="tp-${ct.i}">Full profile &amp; stances ${UI.next}</a>
    </div>`;
  } else {
    topHtml = `<div class="top"><div class="notice">${icon('clipboard', 28)}<span>${anyRecord ? 'None of your answers overlap with the issues these candidates have public positions on. Try the Thorough question set, or open a profile to read their positions.' : 'We haven’t found these candidates’ stances yet, so we can’t score a match. Open a profile to read their own materials.'}</span></div></div>`;
  }
  const rest = scored.filter(x => x !== top);
  return `
  <section class="card race-card">
    <header><h2>${esc(ct.office)}</h2><span>${ct.level}${ct.district ? ' · ' + esc(ct.district) : ''}</span></header>
    ${topHtml}
    ${rest.length ? `<div class="others"><h3>${top ? 'Other candidates in this race' : 'Candidates'}</h3><ul>
      ${rest.map(x => `<li class="other cand-row ${activeKey === ct.i + '/' + x.j ? 'active' : ''}"><a href="#/c/${ct.i}/${x.j}" data-k="o-${ct.i}-${x.j}">
        <span class="o-ini">${x.c.photoUrl ? `<img src="${esc(x.c.photoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : esc(initials(x.c.name))}</span>
        <span class="o-main"><span class="o-name">${esc(x.c.name)}</span><span class="o-party">${esc(x.c.party)}</span></span>
        <span class="o-pct">${x.e.pct === null ? '<span class="muted" style="font-weight:600;font-size:13px">Not rated</span>' : x.e.pct + '%<span class="minibar"><span style="width:' + x.e.pct + '%"></span></span>'}</span>
      </a></li>`).join('')}
    </ul></div>` : ''}
  </section>`;
}

function profileHtml(ct, j, inPane) {
  const c = ct.candidates[j];
  if (!c) return '<div class="pane-empty">Candidate not found.</div>';
  const e = evaluate(c);
  const r = e.rec;
  const links = [];
  if (c.candidateUrl) links.push(['Campaign website', c.candidateUrl]);
  (c.channels || []).forEach(ch => {
    const base = { Facebook: 'https://www.facebook.com/', Twitter: 'https://x.com/', YouTube: 'https://www.youtube.com/' }[ch.type];
    if (!ch.id) return;
    if (/^https?:/i.test(ch.id)) links.push([ch.type, ch.id]); else if (base) links.push([ch.type, base + ch.id]);
  });
  if (!(r && r.demo)) links.push(['Ballotpedia', 'https://ballotpedia.org/wiki/index.php?search=' + encodeURIComponent(c.name)]);
  const others = ct.candidates.map((x, k) => ({ x, k })).filter(o => o.k !== j);
  return `
  <div class="stack" style="gap:18px">
    ${inPane ? '' : `<a class="linkbtn" href="#/results" data-k="back-res" style="align-self:flex-start;display:inline-flex;align-items:center;gap:4px">${UI.back}All matches</a>`}
    <section class="card top-red stack">
      <div class="profile-head">
        <div class="profile-id">
          ${photo(c, 'lg')}
          <div style="min-width:0">
            <div class="kicker">${esc(ct.office)}</div>
            <h1 class="cand-name" style="font-size:clamp(26px,5vw,36px)" tabindex="-1">${esc(c.name)}</h1>
            <div class="cand-sub"><strong>${esc(c.party)}</strong>${c.role ? ' · ' + esc(c.role) : ''}</div>
          </div>
        </div>
        <div class="pct" style="flex-direction:column;align-items:flex-start;gap:2px"><b>${e.pct === null ? '—' : e.pct + '%'}</b><span>${e.pct === null ? (r ? 'answer more questions to compare' : 'not yet rated') : 'aligned with you'}</span></div>
      </div>
      ${c.bio ? `<p style="margin:0;font-size:17px">${esc(c.bio)}</p>` : ''}
      ${links.length ? `<div class="links">${links.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(l)} ${UI.ext}</a>`).join('')}</div>` : ''}
      ${r && r.demo ? '<div class="notice">This is a fictional demo candidate.</div>' : ''}
      ${r && r.researched ? `<div class="notice">Positions summarized from the public sources below as of ${esc(fmtDate(r.researched))}. \u201cNo record\u201d means we didn\u2019t find a public stance. We never guess from party.</div>` : ''}
    </section>
    <section class="card">
      <h2 class="h-ic">${icon('scales', 34)}Where they stand</h2>
      ${r ? `<p class="muted" style="margin:6px 0 12px;font-size:15px">Summarized from public statements, voting records and campaign materials. Bars show how closely each stance matches your answers.</p>
      <div class="topics">
        ${TOPICS.map((t, ti) => {
          const parts = QUESTIONS.filter(q => q.topic === ti).map(q => stance(q, r.positions[q.id])).filter(Boolean);
          const tp = e.topic[ti];
          return `<div class="topic"><div class="topic-h"><h3>${esc(t)}</h3><span>${tp === null ? (parts.length ? 'Not answered' : 'No record') : tp + '% aligned'}</span></div>
            <div class="bar"><span style="width:${tp || 0}%"></span></div>
            <p>${parts.length ? esc(parts.join('. ') + '.') : 'No public stance found in the sources checked.'}</p></div>`;
        }).join('')}
      </div>` : `<div class="notice" style="margin-top:12px">${icon('clipboard', 28)}<span>We haven’t analyzed ${esc(c.name.split(' ')[0])}’s positions yet. Until we do, use the links above to read their own materials.</span></div>`}
    </section>
    ${r && r.sources && r.sources.length ? `<section class="card"><h2 class="h-ic" style="font-size:22px">${icon('doc', 30)}Sources</h2>
      <ul style="margin:12px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:6px">${r.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></li>`).join('')}</ul></section>` : ''}
    ${others.length ? `<section><h2 style="font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px" class="muted">Compare others in this race</h2>
      <div class="links">${others.map(o => { const ex = evaluate(o.x); return `<a href="#/c/${ct.i}/${o.k}" data-k="cmp-${o.k}">${esc(o.x.name)} · ${ex.pct === null ? 'not rated' : ex.pct + '%'}</a>`; }).join('')}</div></section>` : ''}
  </div>`;
}

function viewResults(sel) {
  const list = chosen();
  const answered = qs().filter(q => typeof S.ans[q.id] === 'number').length;
  const wide = WIDE.matches;
  let paneCt = null, paneJ = null;
  if (wide) {
    if (sel) { paneCt = list.find(c => c.i === sel.ci) || contests()[sel.ci] && { ...contests()[sel.ci], i: sel.ci }; paneJ = sel.j; }
    else { for (const ct of list) { const { top } = scoreContest(ct); if (top) { paneCt = ct; paneJ = top.j; break; } } }
  }
  const activeKey = paneCt ? paneCt.i + '/' + paneJ : '';
  return `
  <div class="stack" style="gap:22px">
    <div class="res-head">
      ${icon('ballot', 64)}
      <div>
        <div class="kicker">Your matches · Denton County</div>
        <h1 class="page-h1" tabindex="-1">Your closest match in every race</h1>
        <p class="muted" style="margin:6px 0 0">Based on ${answered} answers, weighted by how much each issue matters to you.</p>
      </div>
    </div>
    <div class="res-layout ${wide ? 'split' : ''}">
      <div class="stack">${list.map(ct => raceCard(ct, activeKey)).join('') || '<div class="card">No races selected.</div>'}</div>
      ${wide ? `<aside class="detail-pane" aria-label="Candidate profile">${paneCt ? profileHtml(paneCt, paneJ, true) : '<div class="card pane-empty">Select a candidate to see their profile.</div>'}</aside>` : ''}
    </div>
    ${extrasHtml(S.ballot)}
    ${S.ballot.links && S.ballot.links.length ? `<div class="stack" style="gap:10px"><h2 style="font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase" class="muted">Before you vote</h2>${linksHtml(S.ballot.links)}</div>` : ''}
  </div>${footer()}`;
}

function viewAbout() {
  const steps = [
    ['pin', '01 · Locate', 'Your districts', 'Statewide and countywide races apply to everyone; U.S. House, Texas House, commissioner and JP races depend on where you live.'],
    ['clipboard', '02 · Ingest', 'Pull races & records', 'Collect contests, candidates, filings, votes, statements, websites and news from the sources below.'],
    ['people', '03 · Resolve', 'One person, one record', 'Match the same candidate across sources by name, office, district and filing IDs.'],
    ['bubbles', '04 · Extract', 'Score stances', 'An AI model maps each sourced passage to the 24 statements on a −2 to +2 scale, with a citation and confidence level.'],
    ['shield', '05 · Review', 'Check & publish', 'Low-confidence or conflicting stances go to human review. Summaries are rebuilt and every change is logged.'],
  ];
  const src = [
    ['Denton County Elections (official contest list)', 'Every race, candidate and proposition on the Nov. 3 ballot', 'Before each election'],
    ['State Secretary of State & county election offices', 'Official candidate filings and sample ballots — the source of truth for who is running', 'Daily'],
    ['OpenFEC (Federal Election Commission API)', 'Federal candidate registrations, committees and fundraising', 'Daily'],
    ['Ballotpedia (licensed data)', 'Local and down-ballot races, bios, candidate surveys', 'Daily'],
    ['Vote Smart', 'Voting records, public statements, Political Courage Test answers', 'Weekly'],
    ['Candidate websites & official social accounts', 'Issue pages and statements, with change detection', 'Weekly; on change'],
    ['News from multiple outlets', 'Debate answers, recent statements, endorsements — balanced across outlets', 'Every 6 hours'],
    ['Official & campaign photos', 'Legislature and congressional portraits, campaign press kits, license-checked images', 'On change'],
  ];
  return `
  <div class="stack" style="gap:28px">
    <div>
      <div class="kicker">Behind the app</div>
      <h1 class="page-h1" tabindex="-1">How the data stays current — and neutral</h1>
      <p class="muted" style="font-size:17px;margin:10px 0 0;max-width:760px">From a ZIP code to a sourced, issue-by-issue profile of every candidate on the ballot.</p>
      <div class="notice" style="margin-top:16px">${'This Denton County edition was researched on ' + esc(fmtDate(DENTON.researched)) + '. Races come from the county\u2019s official contest list; positions come from the sources linked on each candidate\u2019s profile.'}</div>
    </div>
    <section class="stack">
      <h2 class="h-ic">The pipeline</h2>
      <ol class="pipeline">${steps.map(s => `<li class="card top-navy">${icon(s[0], 40)}<div class="kicker" style="margin-top:10px">${s[1]}</div><h3>${s[2]}</h3><p>${s[3]}</p></li>`).join('')}</ol>
    </section>
    <section class="stack">
      <h2 class="h-ic">${icon('watch', 34)}Sources and refresh schedule</h2>
      <div class="card tbl-wrap" style="padding:0"><table><thead><tr><th scope="col">Source</th><th scope="col">What it provides</th><th scope="col">Refresh</th></tr></thead>
        <tbody>${src.map(r => `<tr><td><strong>${esc(r[0])}</strong></td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table></div>
    </section>
    <div class="topics" style="gap:20px">
      <section class="card"><h2 class="h-ic">${icon('scales', 34)}Neutrality guardrails</h2>
        <ul style="margin:14px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:10px">
          <li>Each issue has two statements; across the set, half put the conservative view as “agree” and half the progressive view.</li>
          <li>Party labels stay hidden until results, and party is never used to guess a stance. No record means “No public stance found.”</li>
          <li>Every candidate gets the same sources, scoring and summary format. Voting records outrank campaign rhetoric; newer statements outrank older ones.</li>
          <li>Party labels are plain text, never party colors.</li>
          <li>Every stance links to its source, and the methodology is published.</li>
        </ul></section>
      <section class="card dark-card"><h2 class="h-ic">${icon('pie', 34)}The match score</h2>
        <p>For each statement you and a candidate both have a position on:</p>
        <div class="formula">agreement = 1 − |you − them| ÷ 4</div>
        <p>Your alignment is the average agreement, weighted by importance (Low 1, Medium 2, High 3). Skipped questions and topics with no public record are left out. The app shows how many answers each score rests on, and flags ties.</p></section>
    </div>
    <section class="card top-red"><h2 class="h-ic">${icon('clipboard', 34)}The 24 statements</h2>
      <div class="topics" style="margin-top:8px">${TOPICS.map((t, ti) => `<div class="topic"><h3 style="font-size:16px">${esc(t)}</h3><p>${QUESTIONS.filter(q => q.topic === ti).map(q => esc(q.text)).join('<br>')}</p></div>`).join('')}</div>
    </section>
    <section class="card"><h2 class="h-ic">${icon('shield', 34)}Your privacy</h2>
      <p style="margin:10px 0 0">Your answers are saved only on this device so you can pick up where you left off. They are never sent to a server. Your ZIP code and address are sent only to the ballot lookup service to find your races.</p></section>
  </div>${footer()}`;
}

/* ---------- action bar ---------- */
function actionbar(r) {
  const bar = $('#actionbar'), inn = $('#actionbar-in');
  let html = '';
  if (r.name === 'races') {
    html = `<button type="button" class="btn red block" data-act="start-quiz" data-k="start-quiz" ${S.sel.length ? '' : 'disabled'}>Start the questions (${qs().length}) ${UI.next}</button>`;
  } else if (r.name === 'quiz') {
    const list = qs(), n = Math.min(Math.max(1, +r.a || 1), list.length), q = list[n - 1];
    const answered = typeof S.ans[q.id] === 'number';
    html = `<button type="button" class="btn ghost sm" data-act="back" data-k="back" aria-label="Previous question">${UI.back}<span class="sr">Back</span></button>
      <button type="button" class="linkbtn" data-act="skip" data-k="skip">Skip</button>
      <span class="grow"></span>
      <button type="button" class="btn" data-act="next" data-k="next" ${answered ? '' : 'disabled'}>${n === list.length ? 'See my matches' : 'Next'} ${UI.next}</button>`;
  } else if (r.name === 'results' || (r.name === 'c' && WIDE.matches)) {
    html = `<button type="button" class="btn ghost sm grow" data-act="retake" data-k="retake">Retake questions</button><button type="button" class="btn ghost sm grow" data-act="change" data-k="change">Change races</button>`;
  } else if (r.name === 'about') {
    html = `<button type="button" class="btn ghost sm block" data-act="close-about" data-k="close-about">${UI.back} Back to the app</button>`;
  }
  inn.innerHTML = html;
  bar.hidden = !html;
}

/* ---------- render ---------- */
let lastRoute = '';
function render(force) {
  const r = route();
  const key = location.hash;
  const routeChanged = key !== lastRoute || force;
  // guards
  if (['races', 'quiz', 'results', 'c'].includes(r.name) && !S.ballot) { location.replace('#/start'); return; }
  if (r.name === 'loading' && !S.load) { location.replace(S.ballot ? '#/races' : '#/start'); return; }
  if (r.name === 'quiz' && !S.sel.length) { location.replace('#/races'); return; }

  const focusKey = !routeChanged && document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
  const app = $('#app');
  let html;
  switch (r.name) {
    case 'loading': html = viewLoading(); break;
    case 'races': html = viewRaces(); break;
    case 'quiz': html = viewQuiz(+r.a || 1); break;
    case 'results': html = viewResults(null); break;
    case 'c': {
      const ci = +r.a, j = +r.b, ct = contests()[ci];
      if (!ct) { location.replace('#/results'); return; }
      html = WIDE.matches ? viewResults({ ci, j }) : profileHtml({ ...ct, i: ci }, j, false) + footer();
      break;
    }
    case 'about': html = viewAbout(); break;
    default: html = viewStart();
  }
  app.innerHTML = html;
  steps(r);
  actionbar(r);
  if (r.name === 'start') wireStart();

  if (routeChanged) {
    lastRoute = key;
    if (r.name === 'c' && WIDE.matches) {
      const pane = $('.detail-pane'); if (pane) pane.scrollTop = 0;
      const h = pane && pane.querySelector('h1'); if (h) h.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, 0);
      const h = app.querySelector('h1[tabindex]') || app;
      h.focus({ preventScroll: true });
    }
  } else if (focusKey) {
    const el = document.querySelector(`[data-k="${CSS.escape(focusKey)}"]`);
    if (el) el.focus({ preventScroll: true });
  }
}

function steps(r) {
  const idx = { start: 0, loading: 0, races: 1, quiz: 2, results: 3, c: 3 }[r.name];
  const ol = $('#steps');
  if (idx === undefined) { ol.parentElement.hidden = true; return; }
  ol.parentElement.hidden = false;
  ol.innerHTML = ['Districts', 'Races', 'Your values', 'Matches'].map((l, i) =>
    `<li class="step ${i < idx ? 'done' : i === idx ? 'active' : ''}" ${i === idx ? 'aria-current="step"' : ''}>${l}</li>`).join('');
}

function wireStart() {
  document.querySelectorAll('[data-dist]').forEach(el => el.addEventListener('change', () => { S.dist[el.dataset.dist] = el.value; save(); }));
  $('#distform').addEventListener('submit', ev => {
    ev.preventDefault();
    DIST_KEYS.forEach(k => { S.dist[k] = $('#d-' + k).value; });
    S.ballot = buildBallot(); S.sel = S.ballot.contests.map((_, i) => i); S.all = true;
    save(); go('#/races');
  });
  // iOS install tip
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  if (ios && !standalone && !store.get('iosTipDone', false)) {
    $('#ios-tip').innerHTML = `<div class="notice" style="margin-top:18px">${icon('ballot', 28)}<span>Add Ballot Match to your home screen: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. <button type="button" class="linkbtn" data-act="ios-done" data-k="ios-done">Dismiss</button></span></div>`;
  }
}

/* ---------- actions ---------- */
function act(name, el) {
  const r = route();
  const list = qs();
  const n = Math.min(Math.max(1, +r.a || 1), list.length);
  const q = list[n - 1];
  switch (name) {
    case 'all':
      if (S.all) { S.all = false; S.sel = []; } else { S.all = true; S.sel = contests().map((_, i) => i); }
      save(); render(); break;
    case 'race': {
      const i = +el.dataset.i;
      S.sel = S.sel.includes(i) ? S.sel.filter(x => x !== i) : [...S.sel, i].sort((a, b) => a - b);
      S.all = S.sel.length === contests().length; save(); render(); break;
    }
    case 'mode': S.mode = el.dataset.v; save(); render(); break;
    case 'start-quiz': go('#/quiz/1'); break;
    case 'preset': { const p = DENTON.presets[+el.dataset.i]; DIST_KEYS.forEach(k => { S.dist[k] = p[k] || ''; }); save(); render(); break; }
    case 'ans': S.ans[q.id] = +el.dataset.v; save(); render(); break;
    case 'imp': S.imp[q.id] = +el.dataset.v; save(); render(); break;
    case 'next': if (typeof S.ans[q.id] !== 'number') return; go(n < list.length ? '#/quiz/' + (n + 1) : '#/results'); break;
    case 'skip': S.ans[q.id] = 'skip'; save(); go(n < list.length ? '#/quiz/' + (n + 1) : '#/results'); break;
    case 'back': go(n > 1 ? '#/quiz/' + (n - 1) : '#/races'); break;
    case 'retake': S.ans = {}; S.imp = {}; save(); go('#/quiz/1'); break;
    case 'change': go('#/races'); break;
    case 'demo': S.zip = ($('#zip') && /^\d{5}$/.test($('#zip').value)) ? $('#zip').value : ''; save(); lookup(true); break;
    case 'close-about': if (history.length > 1) history.back(); else go('#/start'); break;
    case 'restart': store.clear(); Object.assign(S, { zip: '', address: '', ballot: null, sel: [], all: true, mode: 'full', ans: {}, imp: {}, error: '', dist: { cd: '', hd: '', pct: '', jp: '' } }); go('#/start'); break;
    case 'ios-done': store.set('iosTipDone', true); $('#ios-tip').innerHTML = ''; break;
    default: break;
  }
}
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  act(el.dataset.act, el);
});

/* keyboard shortcuts on the quiz: 1–5 answer, Enter / → next, ← back */
document.addEventListener('keydown', ev => {
  if (route().name !== 'quiz' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (/^[1-5]$/.test(ev.key)) { const el = document.querySelector(`[data-k="ans-${OPTS[+ev.key - 1][0]}"]`); if (el) { el.focus(); act('ans', el); } }
  else if (ev.key === 'ArrowRight') act('next');
  else if (ev.key === 'ArrowLeft') act('back');
});

/* swipe on the quiz */
let tx = null, ty = null;
document.addEventListener('touchstart', ev => { if (route().name !== 'quiz') return; const t = ev.touches[0]; tx = t.clientX; ty = t.clientY; }, { passive: true });
document.addEventListener('touchend', ev => {
  if (tx === null || route().name !== 'quiz') return;
  const t = ev.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty; tx = ty = null;
  if (Math.abs(dx) < 70 || Math.abs(dy) > 50) return;
  act(dx < 0 ? 'next' : 'back');
}, { passive: true });

/* ---------- install (Android / desktop Chrome) ---------- */
let deferred = null;
window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); deferred = ev; $('#install-btn').hidden = false; });
$('#install-btn').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#install-btn').hidden = true; });
window.addEventListener('appinstalled', () => { $('#install-btn').hidden = true; });

/* ---------- boot ---------- */
async function boot() {
  $('#brand-mark').innerHTML = icon('ballot', 34);
  try {
    const [qd, sd, dd] = await Promise.all([
      fetch('questions.json').then(r => r.json()),
      fetch('stances.json').then(r => r.json()),
      fetch('demo-ballot.json').then(r => r.json()),
    ]);
    DENTON = await fetch('denton.json').then(r => r.json());
    TOPICS = qd.topics; QUESTIONS = qd.questions; STANCES = sd.candidates || {}; DEMO = dd;
  } catch (e) {
    $('#app').innerHTML = '<div class="card notice warn">Ballot Match couldn’t load its data files. If you opened index.html directly from your computer, run it from a web server or GitHub Pages instead (see README).</div>';
    return;
  }
  window.addEventListener('hashchange', () => render());
  WIDE.addEventListener('change', () => render(true));
  render(true);
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
boot();
