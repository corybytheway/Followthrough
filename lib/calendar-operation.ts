// Created by Cory McCabe
import { InputError } from './validation';

// Keep the lease and its cleanup alive when an OAuth redirect closes the
// originating request. A contended interactive connection can wait briefly;
// ordinary syncs still return immediately when another sync owns the lease.
export function runCalendarOperation<T>(
  work: () => Promise<T>,
  lock: {
    acquire: () => Promise<boolean>;
    release: () => Promise<void>;
    retain: (operation: Promise<unknown>) => void;
  },
  waitMs = 0,
): Promise<T> {
  const operation = (async () => {
    const deadline = Date.now() + Math.max(0, Math.min(waitMs, 30_000));
    while (!(await lock.acquire())) {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw Object.assign(
          new InputError(
            'A calendar operation is already running. Try again when it finishes.',
          ),
          { status: 409 },
        );
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250, remaining)),
      );
    }
    try {
      return await work();
    } finally {
      await lock.release();
    }
  })();
  // The caller still receives failures. The retained cleanup must not create
  // a second unhandled rejection or log provider/authentication payloads.
  lock.retain(operation.catch(() => {}));
  return operation;
}
