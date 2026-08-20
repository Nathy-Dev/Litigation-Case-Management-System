/**
 * TEMPORARY smoke harness — not part of the application.
 *
 * Loads the real <App /> at an arbitrary route with a signed-in presenter
 * account, collects anything React or the browser reports as an error, and
 * writes a verdict into the DOM so a headless browser run can assert on it.
 *
 * Usage: /smoke.html#/admin/users  (optionally #/admin/users?role=READ_ONLY)
 */
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import '../index.css';
import type { Role } from '@/types';
import { useDataStore } from '@/store/dataStore';
import { useAuthStore } from '@/store/authStore';

const problems: string[] = [];

const nativeError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  problems.push(args.map(describe).join(' '));
  nativeError(...args);
};

window.addEventListener('error', (event) => problems.push(`window.error: ${event.message}`));
window.addEventListener('unhandledrejection', (event) =>
  problems.push(`unhandledrejection: ${describe(event.reason)}`),
);

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const target = location.hash.slice(1) || '/';
const [path, search = ''] = target.split('?');
const role = (new URLSearchParams(search).get('role') ?? 'SUPER_ADMIN') as Role;

const actor =
  useDataStore.getState().users.find((user) => user.role === role && user.status === 'active') ??
  useDataStore.getState().users[0];
useAuthStore.getState().signInAs(actor.id);

// The router reads window.location when it is created, so rewrite the address
// before the module that builds it is pulled in.
history.replaceState(null, '', path + (search ? `?${search}` : ''));

void import('../App').then(({ App }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  window.setTimeout(() => {
    const root = document.getElementById('root');
    const text = root?.textContent ?? '';
    const verdict = document.createElement('pre');
    verdict.id = 'smoke-verdict';
    verdict.textContent = JSON.stringify(
      {
        route: path,
        role,
        actor: actor.fullName,
        nodes: root?.querySelectorAll('*').length ?? 0,
        chars: text.length,
        heading: document.querySelector('h1')?.textContent ?? null,
        problems,
        status: problems.length === 0 && text.length > 120 ? 'PASS' : 'FAIL',
      },
      null,
      2,
    );
    document.body.appendChild(verdict);
  }, 2500);
});
