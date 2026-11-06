// Created by Cory McCabe
import { assistantPlatform } from './assistant-instructions';
type Destination = { appUrl: string | null; browserUrl: string; mobileAppUrl?: string };
type LaunchEnvironment = {
  open: (url: string) => void;
  listen: (event: 'blur' | 'hidden', callback: () => void) => () => void;
  schedule: (callback: () => void, milliseconds: number) => () => void;
};

/** Protocol launches have no browser installation API. Stop fallback on focus loss. */
export function launchAssistant(
  destination: Destination,
  environment: LaunchEnvironment,
) {
  let finished = false;
  const cleanups: (() => void)[] = [];
  const stop = () => {
    finished = true;
    for (const cleanup of cleanups) cleanup();
  };
  const fallback = () => {
    if (finished) return;
    stop();
    environment.open(destination.browserUrl);
  };
  if (destination.appUrl?.startsWith('https://')) {
    // Universal links let the OS route directly to the installed app or web.
    stop();
    environment.open(destination.appUrl);
    return stop;
  }
  if (!destination.appUrl) {
    fallback();
    return stop;
  }
  cleanups.push(
    environment.listen('blur', stop),
    environment.listen('hidden', stop),
  );
  cleanups.push(environment.schedule(fallback, 1800));
  try {
    environment.open(destination.appUrl);
  } catch {
    fallback();
  }
  return stop;
}

export function launchAssistantInBrowser(destination: Destination) {
  const mobile = assistantPlatform(navigator.userAgent, navigator.maxTouchPoints) === 'ios';
  // Provider-owned universal links route to the app, with OS browser fallback.
  if (mobile && destination.mobileAppUrl) {
    window.location.assign(destination.mobileAppUrl);
    return () => {};
  }
  return launchAssistant(destination, {
    open: (url) => window.location.assign(url),
    listen: (event, callback) => {
      const handler = () => {
        if (event === 'blur' || document.hidden) callback();
      };
      const target = event === 'blur' ? window : document;
      const name = event === 'blur' ? 'blur' : 'visibilitychange';
      target.addEventListener(name, handler);
      return () => target.removeEventListener(name, handler);
    },
    schedule: (callback, milliseconds) => {
      const timer = window.setTimeout(callback, milliseconds);
      return () => window.clearTimeout(timer);
    },
  });
}
