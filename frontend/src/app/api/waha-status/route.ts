import { NextResponse } from 'next/server';
import { WAHA_BASE, WAHA_API_KEY } from '@/lib/waha';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const res = await fetch(`${WAHA_BASE}/api/sessions`, {
      method: "GET",
      headers: {
        "X-Api-Key": WAHA_API_KEY
      },
      // Usamos AbortSignal.timeout(3000) si Node.js es muy moderno, 
      // o pasamos signal de esta forma si es compatible:
      signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined
    });
    
    if (res.ok) {
      const sessions = await res.json();
      
      // WAHA returns an array of sessions. 
      // We check if at least the 'default' session (or any session) is WORKING.
      const isWorking = Array.isArray(sessions) && sessions.some(s => s.status === 'WORKING');
      
      if (isWorking) {
        return NextResponse.json({ status: "online" });
      } else {
        // No se exponen los detalles de la sesión: este endpoint es público.
        return NextResponse.json({ status: "offline", reason: "session_not_working" });
      }
    } else {
      return NextResponse.json({ status: "offline", reason: "status_not_ok", code: res.status });
    }
  } catch (error) {
    return NextResponse.json({ status: "offline", reason: "network_error" });
  }
}
