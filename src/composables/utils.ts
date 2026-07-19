/**
 * Sanitize Google Fonts URL — only allows fonts.googleapis.com and fonts.gstatic.com over HTTPS
 */
export const sanitizeFontUrl = (url: unknown): string => {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:') return ''
    const allowed = ['fonts.googleapis.com', 'fonts.gstatic.com']
    if (!allowed.some((h) => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) return ''
    return parsed.href
  } catch {
    return ''
  }
}

/**
 * Extract a user-friendly error message from Firebase or generic errors
 */
export const functionErrorMessage = (error: unknown, fallback = 'İşlem başarısız.'): string => {
  const raw = String((error as { message?: string })?.message || '').trim()
  if (!raw) return fallback
  return raw.replace(/^[a-z0-9/_-]+:\s*/i, '').trim() || fallback
}

/**
 * Convert Firestore Timestamp / Date / number to milliseconds
 */
export const getTimestampMillis = (value: unknown): number => {
  if (!value) return 0
  if (typeof value === 'number') return value
  if (typeof (value as { toMillis?: () => number })?.toMillis === 'function')
    return (value as { toMillis: () => number }).toMillis()
  if (typeof (value as { toDate?: () => Date })?.toDate === 'function')
    return (value as { toDate: () => Date }).toDate().getTime()
  if (value instanceof Date) return value.getTime()
  const parsed = Date.parse(value as string)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Format any timestamp value to Turkish locale string
 */
export const formatDateTime = (value: unknown): string => {
  const millis = getTimestampMillis(value)
  if (!millis) return '-'
  return new Date(millis).toLocaleString('tr-TR')
}

/**
 * Simple email format regex
 */
export const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
