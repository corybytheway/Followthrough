// Created by Cory McCabe
'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Check,
  X,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  Link2,
} from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import type { Snapshot } from '@/lib/model';
import { minutesLabel } from '@/lib/model';
import {
  SUGGESTION_LABELS,
  suggestionBasisLabel,
  hasExistingSuggestionProjects,
  type SuggestionResponse,
  type TaskSuggestion,
} from '@/lib/suggestion-model';
const expansionEvent = 'suggestions-expansion-changed';
function subscribeExpansion(update: () => void) {
  window.addEventListener('storage', update);
  window.addEventListener(expansionEvent, update);
  return () => {
    window.removeEventListener('storage', update);
    window.removeEventListener(expansionEvent, update);
  };
}
function expandedSnapshot() {
  try {
    return localStorage.getItem('suggestions-expanded') === 'true';
  } catch {
    return false;
  }
}
function subscribeOnline(update: () => void) {
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  return () => {
    window.removeEventListener('online', update);
    window.removeEventListener('offline', update);
  };
}

async function request(
  body?: Record<string, unknown>,
): Promise<SuggestionResponse & { authorizationUrl?: string }> {
  const response = await fetch(
    '/api/suggestions',
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : { cache: 'no-store' },
  );
  const data = (await response.json()) as SuggestionResponse & {
    authorizationUrl?: string;
    error?: string;
  };
  if (!response.ok)
    throw new Error(
      data.error || 'Suggestions could not be updated. Try again.',
    );
  return data;
}
export function SuggestionBadge({
  item,
  label,
}: {
  item: TaskSuggestion;
  label?: string;
}) {
  return (
    <span className="suggestion-source">
      {item.kind === 'gmail' ? (
        <Image
          src="/gmail-logo.png"
          alt=""
          width={16}
          height={16}
          unoptimized
        />
      ) : null}
      {label ?? SUGGESTION_LABELS[item.kind]}
    </span>
  );
}
export default function TaskSuggestions({
  state,
  onAccepted,
}: {
  state: Snapshot;
  onAccepted: () => Promise<unknown>;
}) {
  const [data, setData] = useState<SuggestionResponse | null>(null),
    [all, setAll] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [feedback, setFeedback] = useState<{
      item: TaskSuggestion;
      vote: 'more' | 'less';
    } | null>(null);
  const expanded = useSyncExternalStore(
    subscribeExpansion,
    expandedSnapshot,
    () => false,
  );
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  useEffect(() => {
    let live = true;
    void request()
      .then(async (value) => {
        if (!live) return;
        setData(value);
        if (value.status.available) {
          const next = await request({ action: 'refresh' });
          if (live) setData(next);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [state.revision]);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const next = await request(body);
      setData(next);
      if (body.action === 'accept') {
        await onAccepted();
      }
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!data?.status.available) return null;
  const suggestions = data.suggestions.filter(
    (item) =>
      item.drafts.length > 0 &&
      (item.kind !== 'gmail' ||
        hasExistingSuggestionProjects(item, state.projects)),
  );
  if (!suggestions.length) return null;
  const visible = all ? suggestions : suggestions.slice(0, 3);
  return (
    <section className="suggestions-panel" aria-label="Suggested tasks">
      <button
        type="button"
        className="suggestions-heading"
        aria-expanded={expanded}
        aria-controls="suggestion-cards"
        onClick={() => {
          localStorage.setItem('suggestions-expanded', String(!expanded));
          window.dispatchEvent(new Event(expansionEvent));
        }}
      >
        <span>Suggested tasks</span>
        <ChevronDown className={expanded ? 'expanded' : ''} size={18} />
        <span className="suggestion-count">
          {suggestions.reduce((count, item) => count + item.drafts.length, 0)}
        </span>
      </button>
      {expanded && (
        <div id="suggestion-cards">
          {!online && (
            <p className="suggestions-caption">Offline · saved suggestions</p>
          )}
          {visible.map((item) => (
            <SuggestionCard
              key={item.id}
              item={item}
              state={state}
              enabled={!busy && online}
              onAccept={() =>
                void run({
                  action: 'accept',
                  id: item.id,
                  version: item.version,
                  drafts: item.drafts,
                })
              }
              onDismiss={() =>
                void run({
                  action: 'dismiss',
                  id: item.id,
                  version: item.version,
                })
              }
              onFeedback={(vote) => setFeedback({ item, vote })}
            />
          ))}
          {!all && suggestions.length > 3 && (
            <Button variant="link" onClick={() => setAll(true)}>
              Show{' '}
              {suggestions
                .slice(3)
                .reduce((count, item) => count + item.drafts.length, 0)}{' '}
              more
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Dialog
        open={!!feedback}
        onOpenChange={(open) => {
          if (!open) setFeedback(null);
        }}
      >
        <DialogContent className="suggestion-feedback-dialog">
          <DialogHeader>
            <DialogTitle>Suggest {feedback?.vote} like this?</DialogTitle>
            <DialogDescription>
              Show {feedback?.vote === 'less' ? 'fewer' : 'more'} suggestions
              like “{feedback?.item.drafts[0].title}”
              {feedback?.vote === 'less' ? ', with a 7-day pause.' : '.'}
            </DialogDescription>
          </DialogHeader>
          <div className="suggestion-feedback-actions">
            <Button
              variant="secondary"
              className="suggestion-feedback-cancel"
              onClick={() => setFeedback(null)}
            >
              Cancel
            </Button>
            <Button
              className="suggestion-feedback-primary"
              disabled={busy || !online}
              onClick={async () => {
                if (
                  feedback &&
                  (await run({
                    action: 'feedback',
                    id: feedback.item.id,
                    vote: feedback.vote,
                  }))
                )
                  setFeedback(null);
              }}
            >
              Suggest {feedback?.vote} like this
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
function SuggestionCard({
  item,
  state,
  enabled,
  onAccept,
  onDismiss,
  onFeedback,
}: {
  item: TaskSuggestion;
  state: Snapshot;
  enabled: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  onFeedback: (vote: 'more' | 'less') => void;
}) {
  const linked = item.drafts.length > 1;
  const reference =
    item.kind === 'gmail'
      ? item.source.subject
      : item.source.taskTitle ||
        state.tasks.find((task) => task.id === item.targetTaskId)?.title;
  return (
    <article
      className="suggestion-item"
      aria-label={linked ? 'Linked task suggestions' : undefined}
    >
      <div className={`suggestion-card${linked ? ' suggestion-linked' : ''}`}>
      {item.drafts.map((draft, index) => {
        const project = state.projects.find((p) => p.id === draft.projectId);
        const dependencies = draft.blockedByTaskIndexes
          .map((i) => item.drafts[i]?.title)
          .filter(Boolean);
        return (
          <div className="suggestion-task" key={`${item.id}:${index}`}>
            {index > 0 && (dependencies.length > 0 || !!draft.followsTaskIndexes?.length) && (
              <div className="suggestion-connector">
                <Link2 size={14} aria-hidden="true" />
                <span>Then</span>
              </div>
            )}
            <div className="suggestion-card-heading">
              <h3 className="suggestion-title">
                {project && (
                  <>
                    <i
                      className="suggestion-project-dot"
                      style={{ background: project.color }}
                      aria-hidden="true"
                    />
                    {project.shortName || project.name}:{' '}
                  </>
                )}
                {draft.title}
              </h3>
              {index === 0 && (
                <div className="suggestion-decisions">
                  <Button
                    variant="ghost"
                    aria-label={
                      linked ? 'Accept linked tasks' : `Accept ${draft.title}`
                    }
                    title={
                      linked
                        ? 'Accept linked tasks together'
                        : 'Accept suggestion'
                    }
                    disabled={!enabled}
                    onClick={onAccept}
                  >
                    <Check size={18} />
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={
                      linked
                        ? 'Dismiss linked suggestions'
                        : `Dismiss ${draft.title}`
                    }
                    title={
                      linked
                        ? 'Dismiss linked suggestions together'
                        : 'Dismiss this suggestion'
                    }
                    disabled={!enabled}
                    onClick={onDismiss}
                  >
                    <X size={17} />
                  </Button>
                </div>
              )}
            </div>
            <p className="suggestion-reason">
              <span className="suggestion-based-on">Based on:</span>{' '}
              <SuggestionBadge
                item={item}
                label={suggestionBasisLabel(item)}
              />
              {reference && <> “{reference}”</>}
            </p>
            <div className="suggestion-metadata">
              <span>{minutesLabel(draft.estimateMinutes)} task</span>
              <span className="suggestion-meta-dot" aria-hidden="true" />
              <span
                className={`suggestion-priority suggestion-priority-${draft.priority}`}
              >
                {draft.priority} priority
              </span>
            </div>
          </div>
        );
      })}
      </div>
      <div className="suggestion-feedback">
        <span>
          {linked
            ? 'Were these good suggestions?'
            : 'Was this a good suggestion?'}
        </span>
        <Button
          variant="ghost"
          aria-label={`Suggest more like ${item.drafts[0].title}`}
          aria-pressed={item.feedback === 'more'}
          disabled={!enabled}
          onClick={() => onFeedback('more')}
        >
          <ThumbsUp size={16} />
        </Button>
        <Button
          variant="ghost"
          aria-label={`Suggest less like ${item.drafts[0].title}`}
          aria-pressed={item.feedback === 'less'}
          disabled={!enabled}
          onClick={() => onFeedback('less')}
        >
          <ThumbsDown size={16} />
        </Button>
      </div>
    </article>
  );
}
export function SuggestionSettings() {
  const [data, setData] = useState<SuggestionResponse | null>(null),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    void request()
      .then(setData)
      .catch(() => {});
  }, []);
  const run = async (action: string) => {
    setBusy(true);
    setError('');
    try {
      const next = await request({
        action,
        confirmReadOnly: consent,
        confirmAI: consent,
      });
      if (next.authorizationUrl) {
        window.location.assign(next.authorizationUrl);
        return;
      }
      setData(next);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!data?.status.available) return null;
  return (
    <section className="settings-card">
      <h2>Task suggestions</h2>
      <p>
        Suggestions can recognize routines, remember your workflows, and help
        with tasks that keep getting moved later. Each stays separate from your
        plan until you accept it.
      </p>
      <h3>Gmail · read only</h3>
      <p>
        Optionally review the last seven days of Inbox conversations, excluding
        Promotions, Social, Spam, and Trash. Recent sent replies in those
        conversations help identify requests already handled. Selected email
        text is sent to OpenAI to propose tasks. Attachments are excluded.
        Checks run automatically every five minutes and when Today opens if a
        check is due. Turning this off stops mailbox checks and clears pending
        Gmail suggestions.
      </p>
      {data.status.gmailEnabled ? (
        <>
          <p className="status-label">
            Enabled for {data.status.googleAccount}
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void run('disable_gmail')}
          >
            Turn off Gmail suggestions
          </Button>
        </>
      ) : (
        <>
          <label className="suggestion-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I agree to read-only Gmail review and sending selected email text to
            OpenAI for task suggestions.
          </label>
          <Button
            disabled={busy || !consent || !data.status.googleConnected}
            onClick={() => void run('connect_gmail')}
          >
            Connect Gmail suggestions
          </Button>
          {!data.status.googleConnected && (
            <p className="small-note">
              Connect your Google Calendar account first.
            </p>
          )}
        </>
      )}
      <p className="small-note">
        Email bodies are not saved in tasks or calendar descriptions. OpenAI’s
        retention policies still apply.{' '}
        <Link href="/privacy">Privacy details</Link>
      </p>
      {data.status.error && <p className="small-note">{data.status.error}</p>}
      <Button
        variant="outline"
        disabled={busy || !data.status.feedbackCount}
        onClick={() => void run('reset_feedback')}
      >
        Reset suggestion preferences
      </Button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
