// ArmorTex platform — browser app (phase 0: auth gate, roles, team screen).
// Firebase config is served by Hosting at /__/firebase/init.json, so there is
// nothing to configure in this file.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, collection, onSnapshot, query, orderBy, serverTimestamp, connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const ROLES = { owner: 'Owner', admin: 'Admin', pm: 'PM' };

// ---------- bootstrap ----------
let app, auth, db;
try {
  const cfg = await (await fetch('/__/firebase/init.json')).json();
  app = initializeApp(cfg);
  auth = getAuth(app);
  db = getFirestore(app);
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    // `npm run dev`: talk to the local emulators, never the real project.
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  await setPersistence(auth, browserLocalPersistence);
} catch (e) {
  gate('Could not load Firebase config. This page must be served by Firebase Hosting (or the emulator).', e);
}

// ---------- auth gate ----------
function gate(msg, err, { canSignIn = false, canSignOut = false } = {}) {
  $('gate').classList.remove('hidden');
  $('app').classList.add('hidden');
  $('gateMsg').textContent = msg;
  $('signIn').classList.toggle('hidden', !canSignIn);
  $('gateSignOut').classList.toggle('hidden', !canSignOut);
  $('gateErr').classList.toggle('hidden', !err);
  if (err) $('gateErr').textContent = String(err && err.message || err);
}

$('signIn').addEventListener('click', async () => {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  } catch (e) {
    gate('Sign-in failed.', e, { canSignIn: true });
  }
});
$('gateSignOut').addEventListener('click', () => signOut(auth));
$('signOut').addEventListener('click', () => signOut(auth));

let me = null;          // { email, name, photo, role }
let stopTeam = null;

if (auth) onAuthStateChanged(auth, async (user) => {
  if (stopTeam) { stopTeam(); stopTeam = null; }
  if (!user) { me = null; gate('Sign in with your Google account to continue.', null, { canSignIn: true }); return; }
  gate('Checking your access…');
  try {
    const snap = await getDoc(doc(db, 'staff', user.email));
    if (!snap.exists()) {
      gate(notOnTeam(user.email), null, { canSignOut: true });
      return;
    }
    me = { email: user.email, name: snap.data().name || user.displayName || user.email, photo: user.photoURL, role: snap.data().role };
    enterApp();
  } catch (e) {
    // Non-staff are denied the read by the rules, which is the "not on the team" signal.
    if (e && e.code === 'permission-denied') { gate(notOnTeam(user.email), null, { canSignOut: true }); return; }
    gate('Could not check your access.', e, { canSignOut: true });
  }
});

const notOnTeam = (email) => `${email} is not on the team yet. Ask the owner to add you under Team, then sign in again.`;

function enterApp() {
  $('gate').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('userName').textContent = me.name;
  $('userRole').textContent = ROLES[me.role] || me.role;
  const av = $('userAvatar');
  av.innerHTML = me.photo ? `<img src="${me.photo}" alt="" referrerpolicy="no-referrer">` : initials(me.name);
  const canManage = me.role === 'owner' || me.role === 'admin';
  $('teamAddCard').classList.toggle('hidden', !canManage);
  watchTeam(canManage);
}

const initials = (n) => (n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- team screen ----------
function watchTeam(canManage) {
  const q = query(collection(db, 'staff'), orderBy('name'));
  stopTeam = onSnapshot(q, (qs) => {
    const rows = [];
    qs.forEach(d => {
      const s = d.data();
      const self = d.id === me.email;
      rows.push(`<tr>
        <td><div class="name">${esc(s.name)}${self ? ' <span class="sub">(you)</span>' : ''}</div><div class="sub">${esc(d.id)}</div></td>
        <td><span class="role ${esc(s.role)}">${esc(ROLES[s.role] || s.role)}</span></td>
        <td style="text-align:right">${canManage && !self ? `<button class="btn sm ghost danger" data-remove="${esc(d.id)}">Remove</button>` : ''}</td>
      </tr>`);
    });
    $('teamRows').innerHTML = rows.join('') || '<tr><td colspan="3" class="empty">No one yet.</td></tr>';
  }, (e) => { $('teamRows').innerHTML = `<tr><td colspan="3" class="err">${esc(e.message)}</td></tr>`; });
}

$('teamRows').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-remove]'); if (!btn) return;
  const email = btn.dataset.remove;
  if (!window.confirm(`Remove ${email} from the team? They will lose access immediately.`)) return;
  try { await deleteDoc(doc(db, 'staff', email)); } catch (err) { showErr('teamErr', err); }
});

$('teamForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const email = String(f.get('email')).trim().toLowerCase();
  const name = String(f.get('name')).trim();
  const role = String(f.get('role'));
  if (role === 'owner' && me.role !== 'owner') return showErr('teamErr', new Error('Only an owner can add another owner.'));
  try {
    await setDoc(doc(db, 'staff', email), { name, role, addedBy: me.email, addedAt: serverTimestamp() });
    e.target.reset(); $('teamErr').classList.add('hidden');
  } catch (err) { showErr('teamErr', err); }
});

function showErr(id, err) { const el = $(id); el.textContent = err.message || String(err); el.classList.remove('hidden'); }

// ---------- mockup screens (sample data only; replaced piece by piece) ----------

  // --- mockup-only interactions (no backend) ---
  const show = (name) => {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === name));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.screen === name));
    window.scrollTo(0, 0);
  };
  document.querySelectorAll('[data-screen]').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); show(el.dataset.screen); }));

  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on');
  }));
  document.querySelectorAll('.toggle').forEach(t => t.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    t.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on');
  })));
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); c.classList.add('on');
  }));

  const steps = document.querySelectorAll('.steps > span:not(:empty)');
  document.getElementById('parse').addEventListener('click', () => {
    const b = document.getElementById('parse'); b.textContent = 'Parsing…'; b.disabled = true;
    setTimeout(() => { b.textContent = 'Parsed ✓'; b.disabled = false; steps[1].classList.remove('off'); }, 500);
  });
  document.getElementById('save').addEventListener('click', () => {
    steps[2].classList.remove('off');
    const t = document.getElementById('toast'); t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3500);
  });

  // --- calendar sample data: week of Mon Nov 2 – Sun Nov 8, 2026 (today = Fri Nov 6) ---
  const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], DATES = [2,3,4,5,6,7,8], TODAY = 4;
  const EVENTS = [
    {d:0, h:13, m:0,  len:90, name:'Loretta Nelson', where:'Hideaway', synced:true},
    {d:1, h:10, m:30, len:90, name:'Marcus Reed',    where:'Lindale',  synced:false},
    {d:2, h:15, m:0,  len:90, name:'Dana Whitfield', where:'Tyler',    synced:true},
    {d:4, h:9,  m:0,  len:60, name:'Busy',           where:'Google Calendar', busy:true},
    {d:4, h:14, m:0,  len:90, name:'Tom Baker',      where:'Mineola',  synced:false},
    {d:5, h:11, m:0,  len:90, name:'Gerald & Pam Ortiz', where:'Lindale', synced:true},
  ];
  const fmt = (h,m) => `${((h+11)%12)+1}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;
  const START = 8, HOUR = 56;
  const week = document.getElementById('week');
  let html = '<div></div>' + DAYS.map((d,i)=>`<div class="dayhd ${i===TODAY?'today':''}">${d}<b>${DATES[i]}</b></div>`).join('');
  html += '<div>' + Array.from({length:10},(_,i)=>`<div class="gutter">${fmt(START+i,0)}</div>`).join('') + '</div>';
  for (let i=0;i<7;i++){
    html += `<div class="col ${i===TODAY?'today':''}">` + EVENTS.filter(e=>e.d===i).map(e=>{
      const top=(e.h-START+e.m/60)*HOUR, hgt=e.len/60*HOUR-3;
      const cls = e.busy?'busy':(e.synced?'':'unsynced');
      const st = e.busy?'':(e.synced?'✓':'↑');
      return `<div class="ev ${cls}" style="top:${top}px;height:${hgt}px" ${e.busy?'':'data-open'}><span class="st">${st}</span><b>${e.name}</b>${fmt(e.h,e.m)} · ${e.where}</div>`;
    }).join('') + '</div>';
  }
  week.innerHTML = html;
  const agenda = document.getElementById('agenda');
  agenda.innerHTML = DAYS.map((d,i)=>{
    const evs = EVENTS.filter(e=>e.d===i); if(!evs.length) return '';
    return `<div class="day ${i===TODAY?'today':''}">${d} Nov ${DATES[i]}${i===TODAY?' · Today':''}</div>` + evs.map(e=>
      `<div class="item ${e.busy?'busy':''}" ${e.busy?'':'data-open'}><div class="time">${fmt(e.h,e.m)}</div><div><b>${e.name}</b><div class="sub">${e.where}</div></div><div class="spacer"></div>${e.busy?'':(e.synced?'<span class="pill ok">✓ Synced</span>':'<span class="pill warn">↑ Push</span>')}</div>`).join('');
  }).join('');

  const drawer = document.getElementById('drawer'), scrim = document.getElementById('scrim');
  const openDrawer = () => { drawer.classList.add('open'); scrim.classList.add('show'); };
  const closeDrawer = () => { drawer.classList.remove('open'); scrim.classList.remove('show'); };
  document.querySelectorAll('tr.row').forEach(r => r.addEventListener('click', () => {
    document.querySelectorAll('tr.row').forEach(x => x.classList.remove('sel')); r.classList.add('sel'); openDrawer();
  }));
  document.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', openDrawer));
  document.getElementById('closeDrawer').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
