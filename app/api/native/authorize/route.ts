// Created by Cory McCabe
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { fail } from '@/lib/http';
import { InputError } from '@/lib/validation';
import { issueNativeCode } from '@/lib/native-auth';
import { nativeCallback, validatePairing } from '@/lib/native-security';
export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) throw Object.assign(new InputError('Open sign-in from the app again.'), { status: 403 });
    const user = await getChatGPTUser();
    if (!user) return Response.json({error:'Sign in first.'}, {status:401});
    const form = await request.formData();
    const { challenge, state } = validatePairing(form.get('challenge'), form.get('state'));
    const code = await issueNativeCode(user.userId, challenge);
    return new Response(null, {status:303, headers:{Location:nativeCallback+'?'+new URLSearchParams({code,state}), 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer'}});
  } catch(error) { return fail(error); }
}
