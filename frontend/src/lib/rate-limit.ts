import { LRUCache } from 'lru-cache';
import { NextRequest } from 'next/server';

const rateLimitOptions = {
  max: 500, // Maximum number of IPs to track
  ttl: 60 * 1000, // 1 minute in milliseconds
};

const tokenCache = new LRUCache<string, number>(rateLimitOptions);

export function rateLimit(request: NextRequest | Request, limit: number = 100) {
  // Try to get IP from headers
  const ip = request.headers.get('x-forwarded-for') ?? 
             request.headers.get('x-real-ip') ?? 
             '127.0.0.1';

  const tokenCount = tokenCache.get(ip) || 0;
  
  if (tokenCount >= limit) {
    return { success: false, limit, current: tokenCount, remaining: 0 };
  }
  
  tokenCache.set(ip, tokenCount + 1);
  return { success: true, limit, current: tokenCount + 1, remaining: limit - (tokenCount + 1) };
}
