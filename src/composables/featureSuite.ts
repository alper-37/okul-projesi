/** Okul özellik paketi: taslak, duyuru penceresi, rozet ve iş yükü yardımcıları */

export const QUESTION_DRAFT_KEY = 'adab-question-draft-v1';

export type QuestionDraft = {
  subject: string;
  classLevel: string;
  content: string;
  topicTag: string;
  updatedAt: number;
};

export type AnswerTemplate = {
  id: string;
  label: string;
  body: string;
};

export const DEFAULT_ANSWER_TEMPLATES: AnswerTemplate[] = [
  {
    id: 'ipucu',
    label: 'İpucu',
    body: 'İpucu: Sorunun anahtarını bir kez daha oku; hangi bilgi verilmiş, ne istenmiş? Eksik adımı kendin tamamlamayı dene.',
  },
  {
    id: 'yol',
    label: 'Yol göster',
    body: 'Yol: 1) Verilenleri yaz. 2) İlgili kural/formülü hatırla. 3) Adım adım uygula. 4) Sonucu birim/anlam ile kontrol et.',
  },
  {
    id: 'tam',
    label: 'Tam çözüm',
    body: 'Çözüm: (Adım adım açıklamanı buraya yaz.) Sonuç: …',
  },
];

export const readQuestionDraft = (): QuestionDraft | null => {
  try {
    const raw = localStorage.getItem(QUESTION_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      subject: String(parsed.subject || ''),
      classLevel: String(parsed.classLevel || ''),
      content: String(parsed.content || ''),
      topicTag: String(parsed.topicTag || ''),
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    return null;
  }
};

export const writeQuestionDraft = (draft: Omit<QuestionDraft, 'updatedAt'> & { updatedAt?: number }) => {
  try {
    const payload: QuestionDraft = {
      subject: String(draft.subject || ''),
      classLevel: String(draft.classLevel || ''),
      content: String(draft.content || ''),
      topicTag: String(draft.topicTag || ''),
      updatedAt: draft.updatedAt || Date.now(),
    };
    if (!payload.subject && !payload.classLevel && !payload.content && !payload.topicTag) {
      localStorage.removeItem(QUESTION_DRAFT_KEY);
      return;
    }
    localStorage.setItem(QUESTION_DRAFT_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
};

export const clearQuestionDraft = () => {
  try {
    localStorage.removeItem(QUESTION_DRAFT_KEY);
  } catch {
    /* ignore */
  }
};

export const isAnnouncementActive = (
  settings: {
    announcement?: string;
    announcementStart?: string | null;
    announcementEnd?: string | null;
  },
  nowMs = Date.now(),
): boolean => {
  const text = String(settings?.announcement || '').trim();
  if (!text) return false;
  const startRaw = settings?.announcementStart;
  const endRaw = settings?.announcementEnd;
  if (startRaw) {
    const start = Date.parse(String(startRaw));
    if (!Number.isNaN(start) && nowMs < start) return false;
  }
  if (endRaw) {
    const end = Date.parse(String(endRaw));
    if (!Number.isNaN(end) && nowMs > end) return false;
  }
  return true;
};

export const getPointBadge = (points: number): string => {
  if (points > 200) return '👑 Dahi';
  if (points > 100) return '🏆 Üstad';
  if (points > 50) return '⭐ Kıdemli';
  if (points > 20) return '💡 Gayretli';
  if (points > 5) return '🌱 Filiz';
  return '🆕 Yeni';
};

export const deriveAchievementBadges = (input: {
  points?: number;
  answersAccepted?: number;
  contributionsLast14Days?: number;
  questionsAsked?: number;
}): string[] => {
  const chips: string[] = [];
  const asked = Number(input.questionsAsked || 0);
  const accepted = Number(input.answersAccepted || 0);
  const recent = Number(input.contributionsLast14Days || 0);
  if (asked >= 1) chips.push('🎯 İlk Katkı');
  if (accepted >= 3) chips.push('🤝 Yardımsever');
  if (recent >= 3) chips.push('🔥 Tutarlı');
  return chips;
};

export type WorkloadRow = {
  subject: string;
  unanswered: number;
  pending: number;
  total: number;
};

export const aggregateSubjectWorkload = (
  questions: Array<Record<string, unknown>>,
): WorkloadRow[] => {
  const map = new Map<string, WorkloadRow>();
  for (const q of questions) {
    const subject = String(q.subject || 'Genel').trim() || 'Genel';
    if (!map.has(subject)) {
      map.set(subject, { subject, unanswered: 0, pending: 0, total: 0 });
    }
    const row = map.get(subject)!;
    row.total += 1;
    const hasAnswer = Boolean(q.cevap && String(q.cevap).trim());
    if (!hasAnswer && q.isApproved) row.unanswered += 1;
    if (!q.isApproved && !q.isRejected) row.pending += 1;
  }
  return Array.from(map.values()).sort(
    (a, b) => b.unanswered + b.pending - (a.unanswered + a.pending) || b.total - a.total,
  );
};

export const SEASONAL_THEME_KEYS: string[] = ['bahar', 'kis', 'sinav'];
