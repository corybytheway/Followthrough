// Created by Cory McCabe
import Link from 'next/link';
import { requireChatGPTUser } from '../chatgpt-auth';

export const dynamic = 'force-dynamic';

export default async function PrivacyPage() {
  await requireChatGPTUser('/privacy');
  return (
    <main className="app-shell">
      <header className="app-header">
        <Link href="/today" className="brand">
          ⚡️ Followthrough
        </Link>
      </header>
      <article className="settings-card beta-data-notice">
        <h1>Beta data & privacy</h1>
        <p>
          Followthrough uses your ChatGPT sign-in ID to keep your workspace
          separate from other accounts. Your tasks, projects, work hours, and
          imported busy periods are stored for your account.
        </p>
        <p>
          If you connect Google Calendar, Followthrough stores your connection
          token encrypted, reads the calendars you select to find busy time, and
          writes its task blocks to your primary Google Calendar. Optional
          iCloud calendar credentials are also stored encrypted and used to read
          the calendars you select. Background planning can run while the site
          is closed.
        </p>
        <p>
          When AI planning is available, Followthrough sends your original
          request, relevant project names and descriptions, local date, and time
          zone to OpenAI to draft task titles and steps. These requests use the
          API setting <code>store: false</code>.
        </p>
        <p>
          You can export your workspace as JSON in Settings. Beta invitees can
          erase their Followthrough data there; the app also attempts to remove
          its Google task blocks. The site owner must separately remove your
          invitation to revoke access to the site.
        </p>
        <p>
          For questions or a manual data request, contact{' '}
          <a href="mailto:cory@corymccabe.com">cory@corymccabe.com</a>.
        </p>
        <Link href="/settings">Back to Settings</Link>
      </article>
    </main>
  );
}
