// Created by Cory McCabe
import { APP_ORIGIN } from './app-origin';

// Keep service clients, authentication callbacks, and signed links on their
// original transport. Only ordinary document navigation changes origin.
export function canonicalDocumentUrl(request: Request): URL | null {
  const url = new URL(request.url);
  if (!['followthrough.corymccabe.com', 'followthrough.corybytheway.chatgpt.site'].includes(url.hostname) ||
      !['GET', 'HEAD'].includes(request.method) ||
      !request.headers.get('accept')?.includes('text/html') ||
      /^\/(api|mcp|native|callback|signin-with-chatgpt|signout-with-chatgpt|_next)(\/|$)/.test(url.pathname)) return null;
  return new URL(url.pathname + url.search, APP_ORIGIN);
}
