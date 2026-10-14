// Created by Cory McCabe
import { exchangeNativeCode, refreshNativeSession, revokeNativeSession } from '@/lib/native-auth';
import { fail, jsonBody } from '@/lib/http';
import { object, text } from '@/lib/validation';
export async function POST(request: Request) {
  try {
    const v = object(await jsonBody(request));
    const session = v.refreshToken ? await refreshNativeSession(text(v.refreshToken,'Refresh token',100,true)) :
      await exchangeNativeCode(text(v.code,'Code',100,true),v.verifier,text(v.deviceName,'Device',100,true));
    return Response.json(session,{headers:{'Cache-Control':'no-store'}});
  } catch(error) { return fail(error); }
}
export async function DELETE(request: Request) {
  try { await revokeNativeSession(request); return Response.json({ok:true}); }
  catch(error) { return fail(error); }
}
