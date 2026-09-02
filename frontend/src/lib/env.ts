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
    return process.env.WAHA_API_KEY || '';
  },
  get META_WA_ACCESS_TOKEN() {
    return process.env.META_WA_ACCESS_TOKEN || '';
  },
  get META_WA_PHONE_NUMBER_ID() {
    return process.env.META_WA_PHONE_NUMBER_ID || '';
  },
  get DATABASE_URL() {
    const val = process.env.DATABASE_URL;
    if (!val) throw new Error("CRITICAL: DATABASE_URL is missing from environment variables.");
    return val;
  }
};
