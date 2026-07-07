// Environment variable validation
export const ENV = {
  get JWT_SECRET() {
    const val = process.env.JWT_SECRET;
    if (!val) throw new Error("CRITICAL: JWT_SECRET is missing from environment variables.");
    return val;
  },
  get APP_PASSWORD() {
    const val = process.env.APP_PASSWORD;
    if (!val) throw new Error("CRITICAL: APP_PASSWORD is missing from environment variables.");
    return val;
  },
  get WAHA_API_KEY() {
    const val = process.env.WAHA_API_KEY;
    if (!val) throw new Error("CRITICAL: WAHA_API_KEY is missing from environment variables.");
    return val;
  },
  get N8N_SECRET() {
    const val = process.env.N8N_SECRET;
    if (!val) throw new Error("CRITICAL: N8N_SECRET is missing from environment variables.");
    return val;
  },
  get DATABASE_URL() {
    const val = process.env.DATABASE_URL;
    if (!val) throw new Error("CRITICAL: DATABASE_URL is missing from environment variables.");
    return val;
  }
};
