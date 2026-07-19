import { describe, it, expect } from 'vitest'
import {
  isLeadershipRole,
  isStaffRole,
  getRoleLabel,
  getRoleBadgeIcon,
  normalizeEmailInput,
  normalizeSubjectList
} from '../composables/useRoles'

describe('useRoles', () => {
  describe('isLeadershipRole', () => {
    it('returns true for admin', () => {
      expect(isLeadershipRole('admin')).toBe(true)
    })

    it('returns true for manager', () => {
      expect(isLeadershipRole('manager')).toBe(true)
    })

    it('returns false for teacher', () => {
      expect(isLeadershipRole('teacher')).toBe(false)
    })

    it('returns false for student', () => {
      expect(isLeadershipRole('student')).toBe(false)
    })

    it('handles whitespace', () => {
      expect(isLeadershipRole('  admin  ')).toBe(true)
    })

    it('handles empty/null', () => {
      expect(isLeadershipRole('')).toBe(false)
      expect(isLeadershipRole()).toBe(false)
    })
  })

  describe('isStaffRole', () => {
    it('returns true for teacher', () => {
      expect(isStaffRole('teacher')).toBe(true)
    })

    it('returns true for admin', () => {
      expect(isStaffRole('admin')).toBe(true)
    })

    it('returns false for student', () => {
      expect(isStaffRole('student')).toBe(false)
    })
  })

  describe('getRoleLabel', () => {
    it('returns correct labels', () => {
      expect(getRoleLabel('admin')).toBe('Admin')
      expect(getRoleLabel('manager')).toBe('Yönetici')
      expect(getRoleLabel('teacher')).toBe('Öğretmen')
      expect(getRoleLabel('student')).toBe('Öğrenci')
    })

    it('returns fallback for unknown role', () => {
      expect(getRoleLabel('unknown')).toBe('Kullanıcı')
      expect(getRoleLabel()).toBe('Kullanıcı')
    })
  })

  describe('getRoleBadgeIcon', () => {
    it('returns icons for known roles', () => {
      expect(getRoleBadgeIcon('admin')).toBe('👨‍💼')
      expect(getRoleBadgeIcon('student')).toBe('👨‍🎓')
    })

    it('returns fallback for unknown', () => {
      expect(getRoleBadgeIcon('x')).toBe('👤')
    })
  })

  describe('normalizeEmailInput', () => {
    it('trims and lowercases', () => {
      expect(normalizeEmailInput('  Test@Example.COM  ')).toBe('test@example.com')
    })

    it('handles null/undefined', () => {
      expect(normalizeEmailInput(null)).toBe('')
      expect(normalizeEmailInput(undefined)).toBe('')
    })
  })

  describe('normalizeSubjectList', () => {
    it('trims subjects', () => {
      expect(normalizeSubjectList(['Matematik', ' Fizik '])).toEqual(['Matematik', 'Fizik'])
    })

    it('filters empty strings', () => {
      expect(normalizeSubjectList(['', '  ', 'Tarih'])).toEqual(['Tarih'])
    })

    it('handles non-array', () => {
      expect(normalizeSubjectList(null as unknown as unknown[])).toEqual([])
    })
  })
})
