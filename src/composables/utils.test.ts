import { describe, it, expect } from 'vitest'
import {
  sanitizeFontUrl,
  functionErrorMessage,
  getTimestampMillis,
  formatDateTime,
  SIMPLE_EMAIL_PATTERN
} from '../composables/utils'

describe('utils', () => {
  describe('sanitizeFontUrl', () => {
    it('allows valid Google Fonts URL', () => {
      const url = 'https://fonts.googleapis.com/css2?family=Roboto'
      expect(sanitizeFontUrl(url)).toBe(url)
    })

    it('allows fonts.gstatic.com', () => {
      const url = 'https://fonts.gstatic.com/s/roboto/v30/file.woff2'
      expect(sanitizeFontUrl(url)).toBe(url)
    })

    it('rejects non-HTTPS', () => {
      expect(sanitizeFontUrl('http://fonts.googleapis.com/css')).toBe('')
    })

    it('rejects non-Google domains', () => {
      expect(sanitizeFontUrl('https://evil.com/fonts')).toBe('')
    })

    it('handles empty/null', () => {
      expect(sanitizeFontUrl('')).toBe('')
      expect(sanitizeFontUrl(null)).toBe('')
    })

    it('rejects invalid URLs', () => {
      expect(sanitizeFontUrl('not-a-url')).toBe('')
    })
  })

  describe('functionErrorMessage', () => {
    it('extracts message from error', () => {
      expect(functionErrorMessage(new Error('Something failed'))).toBe('Something failed')
    })

    it('strips Firebase prefix', () => {
      expect(functionErrorMessage({ message: 'auth/user-not-found: User not found' })).toBe('User not found')
    })

    it('returns fallback for empty errors', () => {
      expect(functionErrorMessage(null)).toBe('İşlem başarısız.')
      expect(functionErrorMessage({})).toBe('İşlem başarısız.')
    })

    it('uses custom fallback', () => {
      expect(functionErrorMessage(null, 'Özel hata')).toBe('Özel hata')
    })
  })

  describe('getTimestampMillis', () => {
    it('returns number as-is', () => {
      expect(getTimestampMillis(1234567890)).toBe(1234567890)
    })

    it('handles Date object', () => {
      const d = new Date('2024-01-01T00:00:00Z')
      expect(getTimestampMillis(d)).toBe(d.getTime())
    })

    it('handles Firestore-like toMillis', () => {
      expect(getTimestampMillis({ toMillis: () => 999 })).toBe(999)
    })

    it('handles Firestore-like toDate', () => {
      const d = new Date('2024-06-15')
      expect(getTimestampMillis({ toDate: () => d })).toBe(d.getTime())
    })

    it('returns 0 for null/undefined', () => {
      expect(getTimestampMillis(null)).toBe(0)
      expect(getTimestampMillis(undefined)).toBe(0)
    })
  })

  describe('formatDateTime', () => {
    it('formats valid timestamp', () => {
      const result = formatDateTime(new Date('2024-01-15T10:30:00'))
      expect(result).toContain('2024')
    })

    it('returns dash for null', () => {
      expect(formatDateTime(null)).toBe('-')
    })
  })

  describe('SIMPLE_EMAIL_PATTERN', () => {
    it('matches valid emails', () => {
      expect(SIMPLE_EMAIL_PATTERN.test('test@example.com')).toBe(true)
      expect(SIMPLE_EMAIL_PATTERN.test('user.name@domain.co')).toBe(true)
    })

    it('rejects invalid emails', () => {
      expect(SIMPLE_EMAIL_PATTERN.test('notanemail')).toBe(false)
      expect(SIMPLE_EMAIL_PATTERN.test('@domain.com')).toBe(false)
    })
  })
})
