import { describe, expect, it } from 'vitest';
import {
  aggregateSubjectWorkload,
  deriveAchievementBadges,
  getPointBadge,
  isAnnouncementActive,
} from './featureSuite';
import {
  aggregateFrequentTopics,
  computeContributionIndex,
  normalizeTopicTag,
  suggestionsForSubject,
  topicTrendSplit,
} from './pedagogy';

describe('normalizeTopicTag', () => {
  it('trims and collapses spaces', () => {
    expect(normalizeTopicTag('  Denklemler   Konu  ')).toBe('Denklemler Konu');
  });
});

describe('suggestionsForSubject', () => {
  it('returns matematik topics', () => {
    expect(suggestionsForSubject('Matematik')).toContain('Denklemler');
  });
});

describe('computeContributionIndex', () => {
  it('weights quality signals', () => {
    expect(
      computeContributionIndex({
        points: 10,
        questionsAsked: 2,
        answersAccepted: 1,
        thanksReceived: 2,
      }),
    ).toBe(10 + 8 + 12 + 6);
  });
});

describe('aggregateFrequentTopics', () => {
  it('groups by subject+topic and sorts by count', () => {
    const rows = aggregateFrequentTopics([
      { topicTag: 'Denklemler', subject: 'Matematik', isApproved: true, cevap: 'x=2' },
      { topicTag: 'Denklemler', subject: 'Matematik', cevap: null, isApproved: true },
      { topicTag: 'Şiir', subject: 'Edebiyat', isApproved: false, isRejected: false },
    ]);
    expect(rows[0].topic).toBe('Denklemler');
    expect(rows[0].count).toBe(2);
    expect(rows[0].unanswered).toBe(1);
  });
});

describe('topicTrendSplit', () => {
  it('returns empty when too few samples', () => {
    expect(topicTrendSplit([{ topicTag: 'A', created_at: new Date() }])).toEqual([]);
  });
});

describe('featureSuite helpers', () => {
  it('scores point badges', () => {
    expect(getPointBadge(0)).toContain('Yeni');
    expect(getPointBadge(60)).toContain('Kıdemli');
  });

  it('derives achievement chips', () => {
    const chips = deriveAchievementBadges({
      questionsAsked: 2,
      answersAccepted: 4,
      contributionsLast14Days: 5,
    });
    expect(chips.join(' ')).toMatch(/İlk Katkı/);
    expect(chips.join(' ')).toMatch(/Yardımsever/);
    expect(chips.join(' ')).toMatch(/Tutarlı/);
  });

  it('respects announcement window', () => {
    const now = Date.parse('2026-07-20T12:00:00');
    expect(
      isAnnouncementActive(
        {
          announcement: 'Merhaba',
          announcementStart: '2026-07-19T00:00:00',
          announcementEnd: '2026-07-21T00:00:00',
        },
        now,
      ),
    ).toBe(true);
    expect(
      isAnnouncementActive(
        { announcement: 'Merhaba', announcementEnd: '2026-07-19T00:00:00' },
        now,
      ),
    ).toBe(false);
  });

  it('aggregates teacher workload by subject', () => {
    const rows = aggregateSubjectWorkload([
      { subject: 'Matematik', isApproved: true, cevap: '' },
      { subject: 'Matematik', isApproved: false, isRejected: false },
      { subject: 'Fizik', isApproved: true, cevap: 'ok' },
    ]);
    expect(rows[0].subject).toBe('Matematik');
    expect(rows[0].unanswered).toBe(1);
    expect(rows[0].pending).toBe(1);
  });
});
