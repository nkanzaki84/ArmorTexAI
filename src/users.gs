/**
 * ArmorTex Outreach — users.gs
 * Access control. Roles: owner (Brian), sales (Tanner), viewonly (Caitlin).
 *
 * Every server function that writes starts with _requireRole_(WRITE_ROLES) or
 * _requireRole_(ADMIN_ROLES). Hiding a page in the UI is never the only guard.
 *
 * State lives in the Users tab. OWNER_EMAIL is always owner even if the tab
 * is empty, so Brian can never lock himself out.
 */

function getCurrentUserSession() {
  const email = _userEmail_();
  if (!email) {
    return { denied: true, reason: 'unauthenticated', email: '', name: '', role: null, allowedPages: [], defaultLanding: '' };
  }
  let u = _resolveUser_(email);
  if (u.denied) return Object.assign({ allowedPages: [], defaultLanding: '' }, u);
  // View as (owner only, 2026-11-23): the owner sees the app exactly as another user does.
  // Stored per Google account in user properties, so it follows Brian and nobody else.
  let impersonating = null;
  if (u.role === 'owner') {
    const viewAs = _viewAsEmail_();
    if (viewAs && viewAs !== u.email) {
      const other = _resolveUser_(viewAs);
      if (!other.denied) { impersonating = { realEmail: u.email, realName: u.name, email: other.email, name: other.name, roleLabel: other.roleLabel }; u = other; }
      else _setViewAs_('');   // stale (user removed): drop it
    }
  }
  const allowed = (DEFAULT_ROLE_ACCESS[u.role] || []).slice();
  return {
    denied: false,
    email: u.email,
    name: u.name,
    role: u.role,
    roleLabel: u.roleLabel,
    allowedPages: allowed,
    defaultLanding: 'today',
    canWrite: WRITE_ROLES.indexOf(u.role) !== -1,
    isAdmin: ADMIN_ROLES.indexOf(u.role) !== -1,
    impersonating: impersonating,
  };
}

function _viewAsEmail_() {
  try { return _normEmail_(PropertiesService.getUserProperties().getProperty(PROP_VIEW_AS) || ''); } catch (err) { return ''; }
}
function _setViewAs_(email) {
  const props = PropertiesService.getUserProperties();
  if (email) props.setProperty(PROP_VIEW_AS, email); else props.deleteProperty(PROP_VIEW_AS);
}

/** Owner tool: see the app as another user. Checked against the REAL signed-in user, so it works while already viewing as someone. */
function setViewAs(email) {
  const real = _resolveUser_(_userEmail_());
  if (real.denied || real.role !== 'owner') throw new Error('Only the owner can view as someone else.');
  email = _normEmail_(email);
  if (!email || email === real.email) { _setViewAs_(''); return getCurrentUserSession(); }
  const other = _resolveUser_(email);
  if (other.denied) throw new Error('That person is not on the Users list.');
  _setViewAs_(email);
  return getCurrentUserSession();
}

function clearViewAs() { return setViewAs(''); }

/** People the owner can view as (for the picker). Real owner only. */
function listViewAsChoices() {
  const real = _resolveUser_(_userEmail_());
  if (real.denied || real.role !== 'owner') throw new Error('Only the owner can view as someone else.');
  return _readTab_(TAB.USERS).filter(function (r) { return String(r['Active'] || 'Yes').trim().toLowerCase() !== 'no' && _normEmail_(r['Email']) !== real.email; })
    .map(function (r) { return { email: _normEmail_(r['Email']), name: String(r['Name'] || '').trim() || _normEmail_(r['Email']).split('@')[0], role: String(r['Role'] || '').trim().toLowerCase() }; });
}

function _resolveUser_(emailLower) {
  const email = _normEmail_(emailLower);
  if (!email) return { denied: true, reason: 'unauthenticated' };
  if (email === _normEmail_(OWNER_EMAIL)) {
    return { denied: false, email: email, name: 'Brian', role: 'owner', roleLabel: 'Owner' };
  }
  try {
    const row = _readTab_(TAB.USERS).filter(function (r) { return _normEmail_(r['Email']) === email; })[0];
    if (!row) return { denied: true, reason: 'unlisted', email: email };
    if (String(row['Active'] || 'Yes').trim().toLowerCase() === 'no') return { denied: true, reason: 'deactivated', email: email };
    const roleKey = String(row['Role'] || '').trim().toLowerCase();
    const roleDef = ROLES.filter(function (r) { return r.key === roleKey; })[0];
    if (!roleDef) return { denied: true, reason: 'no_role', email: email };
    return { denied: false, email: email, name: String(row['Name'] || '').trim() || email.split('@')[0], role: roleKey, roleLabel: roleDef.label };
  } catch (err) {
    return { denied: true, reason: 'lookup_failed', message: err.message, email: email };
  }
}

/** Throws unless the current user's role is in `roles`. Returns the session. */
function _requireRole_(roles) {
  const s = getCurrentUserSession();
  if (s.denied) throw new Error('Not signed in or not on the Users list (' + (s.reason || 'denied') + ').');
  if (roles.indexOf(s.role) === -1) throw new Error('Your role (' + s.roleLabel + ') cannot do that.');
  return s;
}

function _requireOwner_() { return _requireRole_(ADMIN_ROLES); }

// ===== Users management (Settings → Team) =====

function listUsers() {
  _requireRole_(ADMIN_ROLES);
  return _readTab_(TAB.USERS);
}

function saveUser(payload) {
  const me = _requireRole_(ADMIN_ROLES);
  const email = _normEmail_(payload && payload.email);
  const role = String(payload && payload.role || '').trim().toLowerCase();
  if (!email || email.indexOf('@') === -1) throw new Error('A valid email is required.');
  if (!ROLES.some(function (r) { return r.key === role; })) throw new Error('Unknown role: ' + role);
  const row = {
    'Email': email,
    'Name': String(payload.name || '').trim() || email.split('@')[0],
    'Role': role,
    'Active': _yes_(payload.active === undefined ? 'Yes' : payload.active) ? 'Yes' : 'No',
  };
  const idx = _findRowIndex_(TAB.USERS, function (r) { return _normEmail_(r['Email']) === email; });
  if (idx === -1) {
    row['Added At'] = new Date();
    row['Added By'] = me.email;
    _appendRows_(TAB.USERS, [row]);
  } else {
    _updateRow_(TAB.USERS, idx, row);
  }
  return { ok: true };
}

function deleteUser(email) {
  const me = _requireRole_(ADMIN_ROLES);
  const target = _normEmail_(email);
  if (target === me.email) throw new Error('You cannot remove yourself.');
  const idx = _findRowIndex_(TAB.USERS, function (r) { return _normEmail_(r['Email']) === target; });
  if (idx === -1) return { ok: true };
  _getTab_(TAB.USERS).deleteRow(idx);
  return { ok: true };
}

/** Active people on the team, for rep pickers. Any signed-in role. */
function listTeamContacts() {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const out = [];
  const seen = {};
  const owner = _normEmail_(OWNER_EMAIL);
  _readTab_(TAB.USERS).forEach(function (u) {
    if (String(u['Active'] || 'Yes').toLowerCase() === 'no') return;
    const e = _normEmail_(u['Email']); if (!e || seen[e]) return; seen[e] = true;
    out.push({ email: e, name: String(u['Name'] || '').trim(), role: String(u['Role'] || '') });
  });
  if (!seen[owner]) out.unshift({ email: owner, name: 'Brian', role: 'owner' });
  return out;
}

/** Called by setup(): make sure the owner appears on the Users tab. */
function _seedUsers_() {
  const idx = _findRowIndex_(TAB.USERS, function (r) { return _normEmail_(r['Email']) === _normEmail_(OWNER_EMAIL); });
  if (idx !== -1) return;
  _appendRows_(TAB.USERS, [{
    'Email': _normEmail_(OWNER_EMAIL), 'Name': 'Brian', 'Role': 'owner', 'Active': 'Yes',
    'Added At': new Date(), 'Added By': 'setup()',
  }]);
}
