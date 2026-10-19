// Created by Cory McCabe
import { NextResponse, type NextRequest } from 'next/server';
import { canonicalDocumentUrl } from './lib/canonical-url';

export function middleware(request: NextRequest) {
  const target = canonicalDocumentUrl(request);
  return target ? NextResponse.redirect(target, 307) : NextResponse.next();
}
