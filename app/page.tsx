// Created by Cory McCabe
import FollowthroughApp from '@/components/followthrough-app';
import { requireChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  await requireChatGPTUser('/');
  return <FollowthroughApp />;
}
