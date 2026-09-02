import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.META_WA_ACCESS_TOKEN && process.env.META_WA_PHONE_NUMBER_ID) {
    return NextResponse.json({ status: "online", provider: "meta" });
  }

  return NextResponse.json({ status: "offline", reason: "meta_not_configured" });
}
