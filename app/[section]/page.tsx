// Created by Cory McCabe
import { notFound } from 'next/navigation';
import FollowthroughApp, {
  type WorkspaceTab,
} from '@/components/followthrough-app';
import { requireChatGPTUser } from '../chatgpt-auth';

export const dynamic = 'force-dynamic';

const SECTIONS = new Set<WorkspaceTab>([
  'today',
  'projects',
  'tasks',
  'settings',
]);

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!SECTIONS.has(section as WorkspaceTab)) notFound();

  const tab = section as WorkspaceTab;
  await requireChatGPTUser(`/${tab}`);
  return <FollowthroughApp initialTab={tab} />;
}
