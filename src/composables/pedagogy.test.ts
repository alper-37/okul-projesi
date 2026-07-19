import { describe, expect, it } from 'vitest';
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
