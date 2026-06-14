// Tells the control-plane which Odoo logins exist in this workspace, so that
// non-owner employees can resolve their workspace/DB at login (find-workspace).
// Authorized server-side by the same-origin Odoo session cookie — the control
// plane asks Odoo who we are and records emails against that session's DB.
// Best-effort: failures are swallowed (login still works for the owner).
export async function registerWorkspaceLogins(emails: (string | false | undefined)[]): Promise<void> {
  const clean = [...new Set(
    (emails || [])
      .map(e => (e || '').toString().trim().toLowerCase())
      .filter(e => e.includes('@'))
  )];
  if (!clean.length) return;
  try {
    await fetch('/api/workspace/register-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ emails: clean }),
    });
  } catch {
    /* best-effort — ignore network/registry errors */
  }
}
