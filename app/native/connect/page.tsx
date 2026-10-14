// Created by Cory McCabe
import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { validatePairing } from '@/lib/native-security';
export const dynamic = 'force-dynamic';
export default async function NativeConnect({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { challenge, state } = validatePairing((await searchParams).challenge, (await searchParams).state);
  const query = new URLSearchParams({ challenge, state });
  const user = await requireChatGPTUser('/native/connect?' + query);
  return <main style={{maxWidth:520,margin:'80px auto',padding:28}}>
    <h1>Connect Followthrough</h1>
    <p>Allow the Followthrough app to view and update the workspace signed in as <strong>{user.email}</strong>.</p>
    <p>Your calendar passwords stay on the server. You can disconnect this device in the app’s Settings.</p>
    <form action="/api/native/authorize" method="POST">
      <input type="hidden" name="challenge" value={challenge}/><input type="hidden" name="state" value={state}/>
      <button type="submit" style={{background:'#2458e6',color:'white',padding:'14px 22px',border:0,borderRadius:12}}>Connect this device</button>
    </form>
  </main>;
}
