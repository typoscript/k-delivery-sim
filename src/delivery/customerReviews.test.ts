import { describe, expect, it } from 'vitest';
import { generateCustomerReview, ReviewGenerationInput } from './RiderCareer';

/** Same inputs + seeded randomness -> same stars, comments and tags (pins the review generator across refactors) */
function run(): { reviews: number; stars: number[]; hash: number } {
  let seed = 98765;
  const origRandom = Math.random;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  try {
    let hash = 0;
    const stars: number[] = [];
    let n = 0;
    for (const integrity of [20, 50, 75, 90, 100])
      for (const temp of [30, 60, 95])
        for (const spill of [0, 8, 15])
          for (const flags of [0, 1, 2, 3, 5, 6, 7]) {
            const input: ReviewGenerationInput = {
              orderNumber: 'A-01',
              shopId: 's',
              shopName: '가게',
              shopEmoji: '🍗',
              menuName: '후라이드 치킨',
              customerName: '고객',
              unitNumber: '101호',
              foodIntegrity: integrity,
              foodTemp: temp,
              foodTempType: flags & 1 ? 'cold' : 'hot',
              isSpillSensitive: (flags & 2) > 0,
              spillDamageAccum: spill,
              remainingRatio: (flags % 4) / 3,
              isWalkupVilla: (flags & 4) > 0,
              isRain: flags === 6,
              isNight: flags === 7,
              deliveryInstruction: flags & 1 ? 'PHOTO_DOOR' : flags & 2 ? 'KNOCK_DOOR' : 'MEET_FACE',
              createdAt: '12:00',
            };
            const r = generateCustomerReview(input);
            n++;
            stars.push(r.stars);
            const s = `${r.stars}|${r.comment}|${r.tags.join(',')}`;
            for (let i = 0; i < s.length; i++) hash = (Math.imul(hash, 31) + s.charCodeAt(i)) | 0;
          }
    return { reviews: n, stars: [1, 2, 3, 4, 5].map((k) => stars.filter((s) => s === k).length), hash };
  } finally {
    Math.random = origRandom;
  }
}

describe('customer review generator fingerprint', () => {
  it('writes the same reviews for the same deliveries', () => {
    const a = run();
    expect(run()).toEqual(a);
    expect(a).toMatchSnapshot();
  });
});
