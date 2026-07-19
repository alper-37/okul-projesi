const STAFF_ROLES = ['teacher', 'manager', 'admin']
const LEADERSHIP_ROLES = ['manager', 'admin']

export const isLeadershipRole = (role = '') => LEADERSHIP_ROLES.includes(String(role || '').trim())
export const isStaffRole = (role = '') => STAFF_ROLES.includes(String(role || '').trim())

export const getRoleLabel = (role = '') => {
  const map: Record<string, string> = {
    admin: 'Admin',
    manager: 'Yönetici',
    teacher: 'Öğretmen',
    student: 'Öğrenci'
  }
  return map[String(role || '').trim()] || 'Kullanıcı'
}

export const getRoleBadgeIcon = (role = '') => {
  const map: Record<string, string> = {
    admin: '👨‍💼',
    manager: '🧭',
    teacher: '👨‍🏫',
    student: '👨‍🎓'
  }
  return map[String(role || '').trim()] || '👤'
}

export const normalizeEmailInput = (email: unknown) => String(email || '').trim().toLowerCase()

export const normalizeSubjectList = (subjects: unknown[]) =>
  Array.isArray(subjects) ? subjects.map((s) => String(s || '').trim()).filter(Boolean) : []
