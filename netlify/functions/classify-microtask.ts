/**
 * Classify-microtask endpoint — used by the UI when the user types a new
 * micro-task title in the dashboard. Returns 0..1 category UUIDs that the
 * LLM thinks fit best, based on the user's categories (description, tags,
 * recent usage). Falls back to an empty list on any failure — the caller
 * (useCreateMicroTask) then falls back to the task_category_buffers default.
 *
 * Why JWT-auth instead of the voice token: this is invoked from the
 * authenticated React app, where the user already has a Supabase access
 * token in `auth.getSession()`. Reusing it is simpler than provisioning
 * yet another secret to copy around.
 *
 * Request:
 *   POST /api/classify-microtask
 *   Authorization: Bearer <supabase access token>
 *   Content-Type: application/json
 *   { "title": "..." }
 *
 * Response:
 *   200 { "category_ids": ["uuid", ...] }   // possibly empty
 *   400/401/500 with text body on failure
 */

import { createClient } from '@supabase/supabase-js';

import { classifyCategoriesForTitle } from './_voice/llm';

const MAX_TITLE_LEN = 200;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return new Response('Missing token', { status: 401 });
  }

  // Body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return new Response('Missing or empty `title`', { status: 400 });
  }
  if (title.length > MAX_TITLE_LEN) {
    return new Response(`Title too long (${MAX_TITLE_LEN} max)`, { status: 400 });
  }

  // Resolve user from the access token using the anon-key client. We use the
  // anon key here (not service-role) because supabase-js's auth.getUser(token)
  // is the public verification path — it doesn't require admin privileges.
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return new Response('Server misconfigured', { status: 500 });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userRes?.user) {
    return new Response('Invalid token', { status: 401 });
  }
  const userId = userRes.user.id;

  // For loadLlmContext + classifyCategoriesForTitle we use the service-role
  // client (same as the voice webhook does). User identity is enforced
  // explicitly via the `userId` filter in every query.
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const result = await classifyCategoriesForTitle(serviceClient, { userId, title });
    if (!result.ok) {
      // Failure is non-fatal for the caller — they fall back to buffer.
      // But we surface 200 + empty so the client doesn't have to special-case.
      console.warn('classify-microtask: LLM failed', result.reason);
      return jsonResponse(200, { category_ids: [], llm_error: result.reason });
    }
    return jsonResponse(200, { category_ids: result.category_ids });
  } catch (err) {
    console.error('classify-microtask: unexpected error', err);
    return new Response((err as Error).message, { status: 500 });
  }
}

export const config = {
  path: '/api/classify-microtask',
};
