import { describe, expect, it } from 'vitest';
import { DEFAULT_NAME_PATTERN, fileBaseName, uniqueNames } from './naming';

const t = { song: 'Grind Demo', n: '02', section: 'Verse', bpm: 200, bars: 8 };

describe('file names', () => {
  it('fills in the tokens', () => {
    expect(fileBaseName(DEFAULT_NAME_PATTERN, t)).toBe('grind-demo-02-verse-200bpm');
    expect(fileBaseName('{section} {bars} bars at {bpm}', { ...t, bpm: 172.5, bars: 7.5 })).toBe('verse 7.5 bars at 172.5');
  });

  it('drops empty tokens with their separator', () => {
    expect(fileBaseName(DEFAULT_NAME_PATTERN, { ...t, n: '', section: '' })).toBe('grind-demo-200bpm');
    expect(fileBaseName('{n}_{section}_{bars}bars', { ...t, n: '' })).toBe('verse_8bars');
    expect(fileBaseName('{section}', { ...t, section: '' })).toBe('grind-demo');
  });

  it('keeps unknown tokens and replaces characters a file name cannot hold', () => {
    expect(fileBaseName('a/b:{nope}', t)).toBe('a-b-{nope}');
  });

  it('makes names unique', () => {
    expect(uniqueNames(['a.mid', 'A.mid', 'a.mid', 'b.mid'])).toEqual(['a.mid', 'A-2.mid', 'a-3.mid', 'b.mid']);
  });
});
