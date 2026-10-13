// Created by Cory McCabe
import { hash, seal, unseal } from './calendar-security';
import { InputError } from './validation';
import type { codexHandoff } from './codex-handoff';

export type Handoff = ReturnType<typeof codexHandoff>;
export type CodexJobState = 'queued' | 'claimed' | 'started' | 'completed' | 'needs_attention' | 'cancelled';
type Device = { id: string; owner_id: string | null; name: string; last_seen: number; setup_expires: number; revoked_at: number | null };
export type Job = { id: string; owner_id: string; task_id: string; task_stamp: string; title: string; payload: string; state: CodexJobState; device_id: string | null; thread_id: string | null; message: string; created_at: number };
const denied = () => Object.assign(new InputError('This Mac connection is unavailable. Connect it again in Settings.'), { status: 401 });
const code = (value: string) => value.replaceAll('-', '').trim().toUpperCase();

export class CodexQueue {
  constructor(private db: D1Database, private encryptionKey: string) {}

  async begin(secret: string, pairingCode: string, name: string, client: string) {
    if (!/^fr_[a-f0-9]{64}$/.test(secret) || !/^[A-F0-9]{10}$/.test(code(pairingCode))) throw denied();
    const now = Date.now(), key = await hash(secret), bucket = await hash(client || 'unknown');
    const existing = await this.db.prepare('SELECT id, owner_id, revoked_at FROM codex_devices WHERE key_hash = ?').bind(key).first<Device>();
    if (existing?.revoked_at) throw denied();
    if (existing?.owner_id && !existing.revoked_at) return { paired: true };
    await this.db.prepare('DELETE FROM codex_devices WHERE owner_id IS NULL AND setup_expires < ?').bind(now).run();
    const count = await this.db.prepare('SELECT COUNT(*) AS count FROM codex_devices WHERE setup_bucket = ? AND owner_id IS NULL AND setup_expires > ?').bind(bucket, now).first<{ count: number }>();
    if ((count?.count || 0) >= 5 && !existing) throw Object.assign(new InputError('Too many connection attempts. Try again in 10 minutes.'), { status: 429 });
    await this.db.prepare('INSERT INTO codex_devices (id, key_hash, pair_hash, name, setup_bucket, setup_expires, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(key_hash) DO UPDATE SET pair_hash = excluded.pair_hash, name = excluded.name, setup_expires = excluded.setup_expires WHERE codex_devices.owner_id IS NULL')
      .bind(crypto.randomUUID(), key, await hash(code(pairingCode)), name.slice(0, 80), bucket, now + 600_000, now).run();
    return { paired: false, expiresAt: now + 600_000 };
  }
  async pending(pairingCode: string) {
    if (!/^[A-F0-9]{10}$/.test(code(pairingCode))) throw new InputError('Enter the pairing code shown by the Mac helper.');
    const device = await this.db.prepare('SELECT id, name, setup_expires FROM codex_devices WHERE pair_hash = ? AND owner_id IS NULL AND revoked_at IS NULL AND setup_expires > ?')
      .bind(await hash(code(pairingCode)), Date.now()).first<Device>();
    if (!device) throw new InputError('This pairing code expired or was already used. Start a new connection in the Mac helper.');
    return device;
  }
  async connect(owner: string, pairingCode: string) {
    const device = await this.pending(pairingCode), now = Date.now();
    const results = await this.db.batch([
      this.db.prepare('UPDATE codex_devices SET revoked_at = ? WHERE owner_id = ? AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM codex_devices WHERE id = ? AND owner_id IS NULL AND setup_expires > ?)').bind(now, owner, device.id, now),
      this.db.prepare('UPDATE codex_devices SET owner_id = ?, pair_hash = NULL, setup_expires = 0 WHERE id = ? AND owner_id IS NULL AND revoked_at IS NULL AND setup_expires > ?').bind(owner, device.id, now),
    ]);
    if (!results[1].meta.changes) throw new InputError('This pairing code was already used. Start a new connection.');
    return this.connection(owner);
  }
  async connection(owner: string) {
    const device = await this.db.prepare('SELECT id, name, last_seen FROM codex_devices WHERE owner_id = ? AND revoked_at IS NULL').bind(owner).first<Device>();
    return { connected: !!device, name: device?.name || null, online: !!device && Date.now() - device.last_seen < 35_000 };
  }
  async disconnect(owner: string) {
    await this.db.batch([
      this.db.prepare('UPDATE codex_devices SET revoked_at = ? WHERE owner_id = ? AND revoked_at IS NULL').bind(Date.now(), owner),
      this.db.prepare("UPDATE codex_jobs SET state = 'cancelled', message = 'Mac connection disconnected.' WHERE owner_id = ? AND state IN ('queued', 'claimed')").bind(owner),
    ]);
  }
  async authenticate(secret: string, allowPending = false) {
    if (!/^fr_[a-f0-9]{64}$/.test(secret)) throw denied();
    const device = await this.db.prepare('SELECT id, owner_id, name, last_seen, setup_expires, revoked_at FROM codex_devices WHERE key_hash = ?').bind(await hash(secret)).first<Device>();
    if (!device || device.revoked_at || (!device.owner_id && (!allowPending || device.setup_expires < Date.now()))) throw denied();
    return device;
  }
  async enqueue(owner: string, stamp: string, handoff: Handoff) {
    if (new TextEncoder().encode(handoff.prompt).length > 200_000) throw new InputError('This task has more context than Codex can receive in one handoff.');
    await this.db.prepare("INSERT INTO codex_jobs (id, owner_id, task_id, task_stamp, title, payload, state, message, created_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', '', ?) ON CONFLICT(owner_id, task_id, task_stamp) DO NOTHING")
      .bind(crypto.randomUUID(), owner, handoff.taskId, stamp, handoff.title, await seal(handoff, this.encryptionKey, owner), Date.now()).run();
    return this.status(owner, handoff.taskId, stamp);
  }
  async status(owner: string, taskId: string, stamp: string) {
    const job = await this.db.prepare('SELECT id, title, state, thread_id, message, created_at FROM codex_jobs WHERE owner_id = ? AND task_id = ? AND task_stamp = ?').bind(owner, taskId, stamp).first<Job>();
    return { job: job ? this.publicJob(job) : null, device: await this.connection(owner) };
  }
  publicJob(job: Job) {
    return { id: job.id, title: job.title, state: job.state, threadId: job.thread_id || null, message: job.message, createdAt: job.created_at };
  }
  async poll(device: Device, busy: boolean) {
    if (!device.owner_id) return null;
    await this.db.prepare('UPDATE codex_devices SET last_seen = ? WHERE id = ? AND revoked_at IS NULL').bind(Date.now(), device.id).run();
    if (busy) return null;
    const held = await this.db.prepare("SELECT * FROM codex_jobs WHERE owner_id = ? AND device_id = ? AND state IN ('claimed', 'started') ORDER BY created_at LIMIT 1").bind(device.owner_id, device.id).first<Job>();
    if (held) return held;
    return this.db.prepare("UPDATE codex_jobs SET state = 'claimed', device_id = ? WHERE id = (SELECT id FROM codex_jobs WHERE owner_id = ? AND state = 'queued' ORDER BY created_at LIMIT 1) AND state = 'queued' RETURNING *")
      .bind(device.id, device.owner_id).first<Job>();
  }
  async context(device: Device, job: Job) {
    if (job.owner_id !== device.owner_id || job.device_id !== device.id) throw denied();
    return unseal<Handoff>(job.payload, this.encryptionKey, job.owner_id);
  }
  async result(device: Device, id: string, state: CodexJobState, threadId: string | null) {
    if (!device.owner_id || !['claimed', 'started', 'completed', 'needs_attention', 'cancelled'].includes(state)) throw denied();
    const message = state === 'cancelled' ? 'The task changed before Codex could start. Send its latest version again.' : state === 'needs_attention' ? 'Codex needs attention. Review the task on your Mac.' : '';
    const result = await this.db.prepare("UPDATE codex_jobs SET state = ?, thread_id = COALESCE(?, thread_id), message = ? WHERE id = ? AND owner_id = ? AND device_id = ? AND (state = 'claimed' OR (state = 'started' AND ? <> 'claimed')) AND (thread_id IS NULL OR ? IS NULL OR thread_id = ?)")
      .bind(state, threadId, message, id, device.owner_id, device.id, state, threadId, threadId).run();
    if (!result.meta.changes) {
      const row = await this.db.prepare('SELECT state, thread_id FROM codex_jobs WHERE id = ? AND owner_id = ? AND device_id = ?').bind(id, device.owner_id, device.id).first<Job>();
      const lateAcknowledgement = (state === 'claimed' || state === 'started') && ['started', 'completed', 'needs_attention'].includes(row?.state || '');
      if (!row || (!lateAcknowledgement && row.state !== state) || (threadId && row.thread_id !== threadId)) throw denied();
    }
  }
}
