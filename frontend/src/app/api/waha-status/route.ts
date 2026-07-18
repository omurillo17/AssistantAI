import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const WAHA_BASE = process.env.WAHA_BASE_URL || "http://localhost:3000";
  const WAHA_API_KEY = process.env.WAHA_API_KEY || "virgo_secret_key";
  
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
        return NextResponse.json({ 
          status: "offline", 
          reason: "session_not_working",
          details: sessions 
        });
      }
    } else {
      return NextResponse.json({ status: "offline", reason: "status_not_ok", code: res.status });
    }
  } catch (error) {
    return NextResponse.json({ status: "offline", reason: "network_error" });
  }
}
