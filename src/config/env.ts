import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  API_VERSION: z.string().default('v1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Database
  DATABASE_URL: z.string().url(),
  IMAGEKIT_ID: z.string().optional(),
  IMAGEKIT_PUBLIC_KEY: z.string().optional(),
  IMAGEKIT_PRIVATE_KEY: z.string().optional(),
  IMAGEKIT_URL_ENDPOINT: z.string().optional(),
  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // MSG91 — OTP SMS
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),
  // Test/staging servers pe jahan SMS actually deliver nahi ho raha (MSG91
  // credits/DND issue), yeh true karne se /auth/send-otp response mein hi
  // OTP wapas aa jaata hai taaki QA manually enter kar sake. PRODUCTION mein
  // yeh kabhi true na ho — default false hai.
  SHOW_OTP_IN_RESPONSE: z.coerce.boolean().default(false),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),

  // Security
  CORS_ORIGIN: z.string().default('*'),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),

  // Session
  MAX_SESSIONS_PER_USER: z.coerce.number().default(3),

  // Agora — Razorpay ki tarah yeh bhi ab core feature (video calls) ke liye
  // zaroori hai, isliye optional() hata diya — .env mein missing hone par ab
  // server boot hi nahi hoga (fail-fast), silently undefined nahi jayega
  AGORA_APP_ID: z.string().min(1, 'AGORA_APP_ID is required'),
  AGORA_APP_CERTIFICATE: z.string().min(1, 'AGORA_APP_CERTIFICATE is required'),
  // RESTful "Usage Inquiry" API creds — separate from the App ID/Certificate
  // pair above (those only sign RTC/RTM tokens). Generated in Agora Console
  // under Restful API. Optional: until these are added, the admin usage
  // endpoint reports itself as "not configured" instead of failing boot.
  AGORA_CUSTOMER_ID: z.string().optional(),
  AGORA_CUSTOMER_SECRET: z.string().optional(),

  // Razorpay
  RAZORPAY_KEY_ID: z.string().min(1, 'RAZORPAY_KEY_ID is required'),
  RAZORPAY_KEY_SECRET: z.string().min(1, 'RAZORPAY_KEY_SECRET is required'),
  RAZORPAY_API_ENDPOINT: z.string().url().default('https://api.razorpay.com'),
  RAZORPAY_API_VERSION_1: z.string().min(1).default('v1'),
  RAZORPAY_API_VERSION_2: z.string().min(1).default('v2'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env