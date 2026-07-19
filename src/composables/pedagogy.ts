/** Pedagojik konu önerileri ve katkı hesapları */

export const SUBJECT_TOPIC_SUGGESTIONS: Record<string, string[]> = {
  Matematik: ['Denklemler', 'Fonksiyonlar', 'Geometri', 'Olasılık', 'Türev', 'İntegral', 'Problemler'],
  Edebiyat: ['Şiir', 'Roman', 'Dil Bilgisi', 'Anlatım Bozukluğu', 'Paragraf', 'Edebi Akımlar'],
  Fizik: ['Hareket', 'Kuvvet', 'Enerji', 'Elektrik', 'Manyetizma', 'Dalgalar', 'Optik'],
  Tarih: ['Osmanlı', 'Cumhuriyet', 'İnkılap', 'Dünya Tarihi', 'Kültür'],
  'Din K.': ['İnanç', 'İbadet', 'Ahlak', 'Siyer', 'Kur’an'],
  Rehberlik: ['Sınav Kaygısı', 'Motivasyon', 'Hedef Belirleme', 'İletişim'],
};

export const normalizeTopicTag = (value: unknown, maxLen = 40): string =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLen);

export const suggestionsForSubject = (subject: string): string[] => {
  const key = String(subject || '').trim();
  if (SUBJECT_TOPIC_SUGGESTIONS[key]) return SUBJECT_TOPIC_SUGGESTIONS[key];
  const found = Object.keys(SUBJECT_TOPIC_SUGGESTIONS).find(
    (k) => k.toLocaleLowerCase('tr') === key.toLocaleLowerCase('tr'),
  );
  return found ? SUBJECT_TOPIC_SUGGESTIONS[found] : [];
};

/** Katkı indeksi: puan + kabul edilen cevap + teşekkür + soru adedi */
export const computeContributionIndex = (input: {
  points?: number;
  questionsAsked?: number;
  answersAccepted?: number;
  thanksReceived?: number;
}): number => {
  const points = Number(input.points || 0);
  const asked = Number(input.questionsAsked || 0);
  const accepted = Number(input.answersAccepted || 0);
  const thanks = Number(input.thanksReceived || 0);
  return Math.round(points * 1 + asked * 4 + accepted * 12 + thanks * 3);
};

export type TopicAgg = {
  topic: string;
  subject: string;
  count: number;
  unanswered: number;
  pending: number;
};

export const aggregateFrequentTopics = (
  questions: Array<Record<string, unknown>>,
  limit = 12,
): TopicAgg[] => {
  const map = new Map<string, TopicAgg>();
  for (const q of questions) {
    const topic = normalizeTopicTag(q.topicTag || q.topic || '');
    if (!topic) continue;
    const subject = String(q.subject || 'Genel');
    const key = `${subject}::${topic.toLocaleLowerCase('tr')}`;
    if (!map.has(key)) {
      map.set(key, { topic, subject, count: 0, unanswered: 0, pending: 0 });
    }
    const entry = map.get(key)!;
    entry.count += 1;
    const hasAnswer = Boolean(q.cevap && String(q.cevap).trim());
    if (!hasAnswer) entry.unanswered += 1;
    if (!q.isApproved && !q.isRejected) entry.pending += 1;
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count || b.unanswered - a.unanswered)
    .slice(0, limit);
};

/** Konu bazlı “önce / sonra” (ilk yarı vs son yarı) */
export const topicTrendSplit = (
  questions: Array<Record<string, unknown>>,
): Array<{ topic: string; firstHalf: number; secondHalf: number; delta: number }> => {
  const withTs = questions
    .map((q) => {
      const created = q.created_at as { toDate?: () => Date } | Date | undefined;
      const ts =
        created && typeof (created as { toDate?: () => Date }).toDate === 'function'
          ? (created as { toDate: () => Date }).toDate().getTime()
          : created instanceof Date
            ? created.getTime()
            : 0;
      return { topic: normalizeTopicTag(q.topicTag), ts };
    })
    .filter((q) => q.topic && q.ts)
    .sort((a, b) => a.ts - b.ts);

  if (withTs.length < 4) return [];
  const mid = Math.floor(withTs.length / 2);
  const first = withTs.slice(0, mid);
  const second = withTs.slice(mid);
  const count = (list: typeof withTs) => {
    const m = new Map<string, number>();
    list.forEach((i) => m.set(i.topic, (m.get(i.topic) || 0) + 1));
    return m;
  };
  const a = count(first);
  const b = count(second);
  const topics = new Set([...a.keys(), ...b.keys()]);
  return Array.from(topics)
    .map((topic) => {
      const firstHalf = a.get(topic) || 0;
      const secondHalf = b.get(topic) || 0;
      return { topic, firstHalf, secondHalf, delta: secondHalf - firstHalf };
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    .slice(0, 10);
};
