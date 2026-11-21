// Calls to the Workforce server. In demo mode the same calls go to the demo story instead.

"use client";

type Handler = (method: string, path: string, body?: unknown) => Promise<unknown>;
let demoHandler: Handler | null = null;

export function setDemoApi(h: Handler | null) {
  demoHandler = h;
}

export async function api<T = unknown>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  if (demoHandler) return (await demoHandler(method, path, body)) as T;
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}
