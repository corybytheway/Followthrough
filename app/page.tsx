// Created by Cory McCabe
import FollowthroughApp from '@/components/followthrough-app';
import { requireChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await requireChatGPTUser('/');
  return <FollowthroughApp userEmail={user.email} />;
}
