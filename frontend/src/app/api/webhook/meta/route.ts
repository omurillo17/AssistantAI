import { NextResponse } from 'next/server';

const BACKEND_API_BASE = process.env.BACKEND_API_BASE || 'http://localhost:8000';
const VERIFY_TOKEN = process.env.META_WA_VERIFY_TOKEN || 'virgo_meta_secret_webhook_2026';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  console.log(`[Meta Webhook GET] mode=${mode} token=${token} challenge=${challenge}`);

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[Meta Webhook] Handshake verificado con éxito token:', token);
    return new Response(challenge || '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  console.warn('[Meta Webhook] Handshake fallido. mode:', mode, 'token:', token);
  return new Response('Verification failed', { status: 403 });
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    console.log('[Meta Webhook POST Entrada]:', rawBody);

    // Reenviar de inmediato al backend FastAPI en segundo plano
    fetch(`${BACKEND_API_BASE}/webhook/meta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: rawBody,
    }).then(async (res) => {
      console.log('[Meta Webhook Backend Response status]:', res.status);
    }).catch((err) => {
      console.error('[Meta Webhook] Error reenviando al backend:', err);
    });

    // Responder 200 OK de inmediato a Meta
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('[Meta Webhook POST Error]:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
