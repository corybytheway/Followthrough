// Created by Cory McCabe
import type { Block, PlanWarning, Workspace } from './model';
const MINUTE = 60_000,
  QUANTUM = 15 * MINUTE,
  HORIZON_DAYS = 42;
export function localDay(
  instant: string | number | Date,
  timeZone: string,
): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  return ['year', 'month', 'day']
    .map((t) => p.find((v) => v.type === t)!.value)
    .join('-');
}
export function clockMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function nextWorkDay(day: string, workDays: number[]): string {
  const date = new Date(day + 'T12:00:00Z');
  for (let offset = 1; offset <= 7; offset++) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (workDays.includes(date.getUTCDay()))
      return date.toISOString().slice(0, 10);
  }
  throw new Error('At least one workday is required.');
}
function overlaps(a: number, b: number, c: number, d: number) {
  return a < d && b > c;
}

export function plan(
  w: Workspace,
  now = Date.now(),
): { blocks: Block[]; warnings: PlanWarning[] } {
  const s = w.settings,
    blocks: Block[] = [],
    warnings: PlanWarning[] = [];
  const taskMap = new Map(w.tasks.map((t) => [t.id, t]));
  const occupied = w.busy.map((e) => ({
    start: Date.parse(e.start),
    end: Date.parse(e.end),
  }));
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: s.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const clock = (instant: number) => {
    const p = formatter.formatToParts(new Date(instant)),
      get = (t: string) => p.find((v) => v.type === t)!.value;
    const day = [get('year'), get('month'), get('day')].join('-');
    return {
      day,
      minutes: Number(get('hour')) * 60 + Number(get('minute')),
      weekday: new Date(day + 'T12:00:00Z').getUTCDay(),
    };
  };
  const startMinute = clockMinutes(s.workStart),
    endMinute = clockMinutes(s.workEnd);
  const remaining = new Map(w.tasks.map((t) => [t.id, t.remainingMinutes]));
  const worked = new Map<string, number>();
  const canSchedule = (taskId: string) => {
    const task = taskMap.get(taskId);
    return Boolean(
      task?.status === 'ready' &&
        task.remainingMinutes &&
        !task.blockers.some((id) => taskMap.get(id)?.status !== 'done'),
    );
  };
  // An elapsed session does not imply progress. Keep its unfinished task at
  // the front of the plan until the user explicitly completes it or records
  // progress. This also lets it displace a different task that had previously
  // been scheduled immediately afterward.
  const rolloverTaskId = w.blocks
    .filter((block) => Date.parse(block.end) <= now && canSchedule(block.taskId))
    .sort(
      (a, b) =>
        Date.parse(b.end) - Date.parse(a.end) ||
        b.start.localeCompare(a.start) ||
        a.id.localeCompare(b.id),
    )[0]?.taskId;
  // Keep the current session stable; elapsed time never implies completed work.
  for (const b of w.blocks) {
    const start = Date.parse(b.start),
      end = Date.parse(b.end),
      t = taskMap.get(b.taskId),
      c = clock(start),
      f = clock(end - 1),
      duration = (end - start) / MINUTE;
    if (
      t?.status === 'ready' &&
      start <= now &&
      end > now &&
      (!rolloverTaskId || b.taskId === rolloverTaskId) &&
      t.remainingMinutes >= duration &&
      !t.blockers.some((id) => taskMap.get(id)?.status !== 'done') &&
      s.workDays.includes(c.weekday) &&
      c.minutes >= startMinute &&
      f.minutes < endMinute &&
      c.day === f.day &&
      (!t.notBefore || c.day >= t.notBefore) &&
      !occupied.some((o) => overlaps(start, end, o.start, o.end))
    ) {
      blocks.push(b);
      occupied.push({ start, end });
      remaining.set(t.id, t.remainingMinutes - duration);
      worked.set(c.day, (worked.get(c.day) || 0) + duration);
    }
  }
  const ranks = { high: 0, medium: 1, low: 2 };
  const candidates = w.tasks
    .filter((t) => {
      if (t.status === 'waiting')
        warnings.push({
          taskId: t.id,
          reason: 'waiting',
          message: 'On hold. Resume when you are ready.',
        });
      if (t.status !== 'ready' || !t.remainingMinutes) return false;
      if (t.blockers.some((id) => taskMap.get(id)?.status !== 'done')) {
        warnings.push({
          taskId: t.id,
          reason: 'blocked',
          message: 'Waiting for its prerequisite task to be completed.',
        });
        return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        Number(b.id === rolloverTaskId) - Number(a.id === rolloverTaskId) ||
        (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
        ranks[a.priority] - ranks[b.priority] ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  // Compute local calendar boundaries once, including DST transitions.
  const slots: { start: number; day: string; minutes: number }[] = [];
  const planningStart = rolloverTaskId
    ? Math.floor(now / QUANTUM) * QUANTUM
    : Math.ceil(now / QUANTUM) * QUANTUM;
  for (
    let start = planningStart;
    start < now + HORIZON_DAYS * 86400000;
    start += QUANTUM
  ) {
    const c = clock(start);
    if (
      s.workDays.includes(c.weekday) &&
      c.minutes >= startMinute &&
      c.minutes < endMinute
    )
      slots.push({ start, day: c.day, minutes: c.minutes });
  }
  for (const t of candidates) {
    let left = remaining.get(t.id) || 0;
    for (const slot of slots) {
      if (left <= 0) break;
      const { start, day, minutes } = slot;
      if (t.notBefore && day < t.notBefore) continue;
      let duration = t.splittable
        ? Math.min(left, s.maxBlockMinutes, endMinute - minutes)
        : left;
      if (minutes + duration > endMinute) continue;
      const amount = worked.get(day) || 0,
        cycle = s.breakEveryMinutes + s.breakMinutes,
        phase = amount % cycle;
      if (s.breakMinutes && phase >= s.breakEveryMinutes) {
        const gap = cycle - phase,
          end = start + gap * MINUTE;
        if (
          minutes + gap <= endMinute &&
          !occupied.some((o) => overlaps(start, end, o.start, o.end))
        ) {
          occupied.push({ start, end });
          worked.set(day, amount + gap);
        }
        continue;
      }
      if (t.splittable && s.breakMinutes)
        duration = Math.min(duration, s.breakEveryMinutes - phase);
      const conflict = occupied
        .filter((o) =>
          overlaps(start, start + duration * MINUTE, o.start, o.end),
        )
        .sort((a, b) => a.start - b.start)[0];
      if (conflict) {
        const available = Math.floor((conflict.start - start) / QUANTUM) * 15;
        if (!t.splittable || available < Math.min(left, 15)) continue;
        duration = Math.min(duration, available);
      }
      if (duration <= 0) continue;
      const end = start + duration * MINUTE;
      const finish = clock(end - 1);
      if (finish.day !== day || finish.minutes >= endMinute) continue;
      blocks.push({
        id: `${t.id}-${blocks.filter((b) => b.taskId === t.id).length}`,
        taskId: t.id,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        kind: 'task',
      });
      occupied.push({ start, end });
      worked.set(day, (worked.get(day) || 0) + duration);
      left -= duration;
    }
    if (left > 0)
      warnings.push({
        taskId: t.id,
        reason: 'capacity',
        message: `${left} minutes do not fit in the next ${HORIZON_DAYS} days. Adjust availability or allow multiple sessions.`,
      });
    if (
      t.dueDate &&
      (left > 0 ||
        blocks.some(
          (b) =>
            b.taskId === t.id &&
            localDay(Date.parse(b.end) - 1, s.timeZone) > t.dueDate!,
        ))
    )
      warnings.push({
        taskId: t.id,
        reason: 'deadline',
        message:
          'This task may miss its deadline with the time currently available.',
      });
  }
  blocks.sort(
    (a, b) =>
      a.start.localeCompare(b.start) || a.taskId.localeCompare(b.taskId),
  );
  return { blocks, warnings };
}
