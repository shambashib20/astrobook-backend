// Ek hi phone format poore system mein: "+91XXXXXXXXXX".
//
// Pehle alag flows alag format mein save karte the — OTP login "+91XXXXXXXXXX"
// (auth schema enforce karta hai) aur onboarding ka phone-verification bare
// "XXXXXXXXXX" (users schema +91 strip kar deta hai, kyunki Razorpay ke liye
// wahi chahiye tha). users.phone pe unique constraint exact-string match karta
// hai, isliye ek hi insaan ka number do formats mein do alag accounts bana deta
// tha (Google account + OTP account). Ab har jagah yahi canonical form.
//
// Accepts "9830012345", "919830012345", "+919830012345", "09830012345",
// spaces/dashes ke saath bhi. Invalid ho to null.
export function toCanonicalIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  let ten: string
  if (digits.length === 10) ten = digits
  else if (digits.length === 11 && digits.startsWith('0')) ten = digits.slice(1)
  else if (digits.length === 12 && digits.startsWith('91')) ten = digits.slice(2)
  else return null
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null
}
