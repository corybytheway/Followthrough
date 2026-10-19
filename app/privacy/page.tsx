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
          Optional task suggestions use your task completion history, checklist
          progress, and user changes that move a start date later to recognize
          routines and suggest smaller first steps. Automatic calendar movements
          do not count as postponements. Suggestions stay separate from your
          plan until you review them. More/less feedback is private to your
          account and can be reset in Settings.
        </p>
        <p>
          If you explicitly enable Gmail suggestions, Followthrough requests
          read-only Gmail access for your connected Google account. It reviews
          seven days of Inbox conversations, excluding Promotions, Social, Spam
          and Trash, and recent sent replies in those conversations. Selected
          plain-text email content is sent to OpenAI to identify clear actions.
          Attachments and remote content are excluded. Full email bodies are not
          stored in tasks or calendar descriptions. Minimal evidence and
          proposed tasks are encrypted; unreviewed suggestions expire after
          thirty days and content-free dismissal identifiers after ninety days.
          Turning off Gmail suggestions stops reading and removes pending email
          suggestions. Tasks you already accepted remain part of your workspace.
        </p>
        <p>
          Followthrough’s use and transfer of information received from Google
          APIs adheres to the Google API Services User Data Policy, including
          its Limited Use requirements. OpenAI requests use store: false. This
          disables response application-state storage; it does not establish
          Zero Data Retention. OpenAI may retain content in abuse-monitoring
          logs according to your organization’s applicable controls and
          policies.{' '}
          <a href="https://developers.openai.com/api/docs/guides/your-data">
            OpenAI data controls
          </a>
          .
        </p>
        <p>
          Followthrough uses your ChatGPT sign-in ID to keep your workspace
          separate from other accounts. Your tasks, projects, work hours, and
          imported busy periods are stored for your account.
        </p>
        <p>
          If you connect Google Calendar, Followthrough stores your connection
          token encrypted, reads the calendars you select to find busy time, and
          writes its task blocks to your primary Google Calendar. Optional
          iCloud and Zoho calendar credentials are also stored encrypted and
          used to read the calendars you select. Background planning can run
          while the site is closed.
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
