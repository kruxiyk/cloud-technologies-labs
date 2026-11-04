import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, inMemoryPersistence, setPersistence } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
const element = id => document.getElementById(id);
const showError = error => { element('out').textContent = error.message; };
try {
  const response = await fetch('/firebase-config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Неможливо отримати конфігурацію Firebase');
  const config = await response.json();
  if (!config.apiKey || config.apiKey.startsWith('REPLACE_')) throw new Error('Спочатку задайте FIREBASE_API_KEY у wrangler.jsonc');
  const auth = getAuth(initializeApp(config));
  await setPersistence(auth, inMemoryPersistence);
  for (const id of ['google', 'password-login', 'register']) element(id).disabled = false;
  element('out').textContent = 'Увійдіть через Google або електронну пошту.';
  element('google').onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(showError);
  element('password-form').onsubmit = async event => {
    event.preventDefault();
    try { await signInWithEmailAndPassword(auth, element('email').value, element('password').value); element('password').value = ''; } catch (error) { showError(error); }
  };
  element('register').onclick = async () => {
    if (!element('password-form').reportValidity()) return;
    try { await createUserWithEmailAndPassword(auth, element('email').value, element('password').value); element('password').value = ''; } catch (error) { showError(error); }
  };
  element('signout').onclick = () => signOut(auth).catch(showError);
  element('copy').onclick = () => navigator.clipboard.writeText(element('token').value).catch(showError);
  element('refresh').onclick = async () => {
    try { element('token').value = await auth.currentUser.getIdToken(true); } catch (error) { showError(error); }
  };
  onIdTokenChanged(auth, async user => {
    element('identity').textContent = user ? `uid: ${user.uid} · email: ${user.email ?? '—'}` : 'Вхід ще не виконано.';
    element('token').value = user ? await user.getIdToken() : '';
    element('signout').hidden = !user;
    element('password-form').hidden = Boolean(user);
    element('google').hidden = Boolean(user);
    for (const id of ['copy', 'refresh', 'call']) element(id).disabled = !user;
  }, showError);
  element('call').onclick = async () => {
    try {
      const url = new URL(element('path').value, location.origin);
      if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) throw new Error('Дозволені лише /api/ маршрути цього Worker');
      const response = await fetch(url, { headers: { authorization: `Bearer ${await auth.currentUser.getIdToken()}` }, cache: 'no-store' });
      element('out').textContent = `${response.status} cache-control: ${response.headers.get('cache-control')}\n${await response.text()}`;
    } catch (error) { showError(error); }
  };
} catch (error) { showError(error); }
