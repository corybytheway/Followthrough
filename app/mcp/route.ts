// Created by Cory McCabe
import { requireOwner, jsonBody, fail } from '@/lib/http';
import { snapshot, mutate } from '@/lib/store';
import { TOOL_DEFINITIONS, toolAction } from '@/lib/tools';
import { object } from '@/lib/validation';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request, true),
      message = object(await jsonBody(request)),
      id = message.id;
    const reply = (result: unknown) =>
      Response.json(
        { jsonrpc: '2.0', id, result },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    if (message.jsonrpc !== '2.0')
      return Response.json(
        {
          jsonrpc: '2.0',
          id: id || null,
          error: { code: -32600, message: 'Invalid JSON-RPC request.' },
        },
        { status: 400 },
      );
    if (message.method === 'notifications/initialized')
      return new Response(null, { status: 202 });
    if (message.method === 'initialize')
      return reply({
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'Followthrough', version: '0.1.0' },
        instructions:
          'Keep a focused outcome as one task. Use checklist steps for implementation, testing, and publishing. Never split a task just because it takes several sessions. Read the workspace before assigning projects or dependencies.',
      });
    if (message.method === 'ping') return reply({});
    if (message.method === 'tools/list')
      return reply({ tools: TOOL_DEFINITIONS });
    if (message.method === 'tools/call') {
      try {
        const params = object(message.params),
          action = toolAction(String(params.name), params.arguments || {});
        const result = action
          ? await mutate(owner, { ...action, requestId: crypto.randomUUID() })
          : await snapshot(owner);
        return reply({
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: false,
        });
      } catch (e) {
        return reply({
          content: [
            {
              type: 'text',
              text: e instanceof Error ? e.message : 'Invalid tool input.',
            },
          ],
          isError: true,
        });
      }
    }
    return Response.json({
      jsonrpc: '2.0',
      id: id || null,
      error: { code: -32601, message: 'Method not found.' },
    });
  } catch (e) {
    return fail(e);
  }
}
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
