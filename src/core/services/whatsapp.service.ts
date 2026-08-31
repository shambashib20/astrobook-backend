import { env } from '@/config/env'
import axios from 'axios'

// Rajesh ke self-hosted WhatsApp panel (same ETC CRM wala instance) ke
// through message bhejta hai — AstroBook ke apne connected device
// (WHATSAPP_DEVICE_TOKEN) se.
//
// NOTE: panel ka Swagger doc field ka naam "to" batata hai, lekin yeh galat
// hai — actual API "numbers" expect karta hai ("to" bhejne par 400/500
// error aata hai: "device_token required" / DB constraint violation on
// "recipient" column). Yeh confirmed hua panel ke apne WA Console
// frontend ka live network request dekh ke. Field names neeche wahi hain
// jo actually kaam karte hain, Swagger docs ke bharose mat rehna.

type SendWhatsAppResult = { sent: boolean; id?: number }

export async function sendWhatsAppMessage(phone: string, message: string): Promise<SendWhatsAppResult> {
  if (!env.WHATSAPP_API_KEY || !env.WHATSAPP_DEVICE_TOKEN) {
    throw new Error('WhatsApp API not configured — WHATSAPP_API_KEY/WHATSAPP_DEVICE_TOKEN missing in .env')
  }

  const res = await axios.post(
    `${env.WHATSAPP_API_URL}/api/sendmessage`,
    {
      device_token: env.WHATSAPP_DEVICE_TOKEN,
      numbers:      phone,
      message,
      media:        [],
      delay:        null,
      schedule:     null,
    },
    {
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_API_KEY}`,
        'Content-Type': 'application/json',
      },
    },
  )

  // status: 1 = success, 0 = failure (panel's own convention, not HTTP status)
  if (res.data?.status !== 1) {
    throw new Error(`WhatsApp send failed: ${res.data?.description ?? 'unknown error'}`)
  }

  return { sent: !!res.data?.data?.sent, id: res.data?.data?.id }
}

// OTP ke liye ready-made message format — sendOtpSms se reuse hota hai.
export async function sendOtpWhatsApp(phone: string, otp: string): Promise<void> {
  await sendWhatsAppMessage(phone, `Aapka AstroBook OTP hai: ${otp}. Yeh 5 minute mein expire ho jayega. Kisi ke saath share mat karo.`)
}
