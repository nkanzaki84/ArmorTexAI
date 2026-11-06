// Firestore rules tests. Run with: npm run test:rules  (starts the emulator for you)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

let env;
const PROJECT = 'demo-armortex';
const OWNER = 'owner@example.com', ADMIN = 'admin@example.com', PM = 'pm@example.com', STRANGER = 'nobody@example.com';
const as = (email, extra = {}) => env.authenticatedContext(email.replace(/\W/g, '_'), { email, email_verified: true, ...extra }).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'staff', OWNER), { name: 'Owner', role: 'owner' });
    await setDoc(doc(db, 'staff', ADMIN), { name: 'Admin', role: 'admin' });
    await setDoc(doc(db, 'staff', PM), { name: 'PM', role: 'pm' });
    await setDoc(doc(db, 'customers', 'c1'), { first: 'Loretta', last: 'Nelson' });
  });
});

test('signed-out users read nothing', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'staff', OWNER)));
  await assertFails(getDoc(doc(db, 'customers', 'c1')));
});

test('signed-in non-staff read nothing', async () => {
  const db = as(STRANGER);
  await assertFails(getDoc(doc(db, 'staff', STRANGER)));
  await assertFails(getDocs(collection(db, 'customers')));
});

test('unverified email is not staff even if allowlisted', async () => {
  const db = env.authenticatedContext('x', { email: PM, email_verified: false }).firestore();
  await assertFails(getDoc(doc(db, 'customers', 'c1')));
});

test('staff read team and business data', async () => {
  await assertSucceeds(getDocs(collection(as(PM), 'staff')));
  await assertSucceeds(getDoc(doc(as(PM), 'customers', 'c1')));
  await assertSucceeds(setDoc(doc(as(PM), 'customers', 'c2'), { first: 'Tom' }));
});

test('pm cannot manage team; admin can add pm/admin; only owner adds owner', async () => {
  await assertFails(setDoc(doc(as(PM), 'staff', 'new@example.com'), { name: 'New', role: 'pm' }));
  await assertSucceeds(setDoc(doc(as(ADMIN), 'staff', 'new@example.com'), { name: 'New', role: 'pm' }));
  await assertSucceeds(setDoc(doc(as(ADMIN), 'staff', 'new2@example.com'), { name: 'New2', role: 'admin' }));
  await assertFails(setDoc(doc(as(ADMIN), 'staff', 'boss@example.com'), { name: 'Boss', role: 'owner' }));
  await assertSucceeds(setDoc(doc(as(OWNER), 'staff', 'boss@example.com'), { name: 'Boss', role: 'owner' }));
  await assertFails(setDoc(doc(as(OWNER), 'staff', 'bad@example.com'), { name: 'Bad', role: 'superuser' }));
  await assertFails(setDoc(doc(as(OWNER), 'staff', 'bad@example.com'), { role: 'pm' }));
});

test('removals: not yourself, owners only by owners', async () => {
  await assertFails(deleteDoc(doc(as(ADMIN), 'staff', ADMIN)));
  await assertFails(deleteDoc(doc(as(ADMIN), 'staff', OWNER)));
  await assertSucceeds(deleteDoc(doc(as(ADMIN), 'staff', PM)));
  await assertSucceeds(deleteDoc(doc(as(OWNER), 'staff', ADMIN)));
});

test('settings: staff read, admin write', async () => {
  await assertSucceeds(setDoc(doc(as(ADMIN), 'settings', 'calendar'), { calendarId: 'x' }));
  await assertSucceeds(getDoc(doc(as(PM), 'settings', 'calendar')));
  await assertFails(setDoc(doc(as(PM), 'settings', 'calendar'), { calendarId: 'y' }));
});

test('unknown collections are denied even for owner', async () => {
  await assertFails(setDoc(doc(as(OWNER), 'secrets', 's'), { a: 1 }));
});
