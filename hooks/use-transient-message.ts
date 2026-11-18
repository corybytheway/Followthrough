// Created by Cory McCabe
'use client';

import { useCallback, useEffect, useState } from 'react';

const MESSAGE_DURATION_MS = 5_000;

export function useTransientMessage() {
  const [entry, setEntry] = useState({ message: '' });
  const showMessage = useCallback((message: string) => {
    // A repeated message is a new notification with its own countdown.
    setEntry({ message });
  }, []);

  useEffect(() => {
    if (!entry.message) return;
    const timer = window.setTimeout(() => {
      setEntry({ message: '' });
    }, MESSAGE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [entry]);

  return [entry.message, showMessage] as const;
}
