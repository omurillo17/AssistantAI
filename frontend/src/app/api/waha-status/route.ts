import { NextResponse } from 'next/server';
import { WAHA_BASE, WAHA_API_KEY } from '@/lib/waha';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!WAHA_BASE) {
    return NextResponse.json({ status: "offline", reason: "waha_not_configured" });
  }

  try {
    const res = await fetch(`${WAHA_BASE}/api/sessions`, {
      method: "GET",
      headers: {
        "X-Api-Key": WAHA_API_KEY,
      },
      signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined,
    });

    if (res.ok) {
      const sessions = await res.json();
      const isWorking = Array.isArray(sessions) && sessions.some((s) => s.status === 'WORKING');
      if (isWorking) {
        return NextResponse.json({ status: "online", provider: "waha" });
      }
      return NextResponse.json({ status: "offline", reason: "session_not_working" });
    }

    return NextResponse.json({ status: "offline", reason: "status_not_ok", code: res.status });
  } catch {
    return NextResponse.json({ status: "offline", reason: "network_error" });
  }
}
