// Created by Cory McCabe
import { InputError } from './validation';
export const nativeCallback = 'followthrough://auth';
export function validatePairing(challenge: unknown, state: unknown) {
  if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
      typeof state !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(state))
    throw new InputError('Start sign-in again from the Followthrough app.');
  return { challenge, state };
}
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function secretToken(prefix = '') {
  return prefix + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export async function verifyProof(verifier: unknown, challenge: string) {
  return typeof verifier === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) && await digest(verifier) === challenge;
}
