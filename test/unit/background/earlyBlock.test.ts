import { describe, expect, it } from 'vitest';

import { buildEarlyBlockRules } from '../../../src/background/earlyBlock';
import { createFilteringEngine } from '../../../src/shared/filtering/engine';
import type { ScheduleContext } from '../../../src/shared/filtering/schedules';
import type { Filter, FilterGroup, StorageData, Whitelist } from '../../../src/shared/types';

type Rule = chrome.declarativeNetRequest.Rule;

const always: FilterGroup = { id: 'always', name: '24/7', schedules: [], is24x7: true };
const work: FilterGroup = {
  id: 'work',
  name: 'Work',
  schedules: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' }],
  is24x7: false,
};
const mondayMorning: ScheduleContext = { dayOfWeek: 1, time: '10:00' };
const mondayNight: ScheduleContext = { dayOfWeek: 1, time: '22:00' };

function createStorageData(overrides: Partial<StorageData> = {}): StorageData {
  return {
    groups: overrides.groups ?? [always],
    filters: overrides.filters ?? [],
    whitelist: overrides.whitelist ?? [],
    snooze: overrides.snooze ?? { active: false },
    rulesVersion: 1,
    schemaVersion: 2,
  };
}

function filter(pattern: string, overrides: Partial<Filter> = {}): Filter {
  return {
    id: pattern,
    pattern,
    groupId: always.id,
    enabled: true,
    matchMode: 'domain',
    ...overrides,
  };
}

function exception(pattern: string, overrides: Partial<Whitelist> = {}): Whitelist {
  return {
    id: `allow ${pattern}`,
    pattern,
    groupId: always.id,
    enabled: true,
    matchMode: 'contains',
    ...overrides,
  };
}

const acceptEveryRegex = (): Promise<boolean> => Promise.resolve(true);
const rejectEveryRegex = (): Promise<boolean> => Promise.resolve(false);

function build(data: StorageData, context = mondayMorning): Promise<Rule[]> {
  return buildEarlyBlockRules(data, acceptEveryRegex, context);
}

/** Whether a rule's condition matches an address, the way Chrome reads these conditions. */
function ruleMatches(rule: Rule, address: string): boolean {
  const url = new URL(address);
  url.hash = '';
  const { requestDomains, urlFilter, regexFilter, isUrlFilterCaseSensitive } = rule.condition;
  if (requestDomains) {
    return requestDomains.some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
    );
  }
  if (urlFilter !== undefined) {
    const href = url.href.toLowerCase();
    const text = urlFilter.toLowerCase();
    return text.startsWith('|') ? `|${href}|` === text : href.includes(text);
  }
  return new RegExp(regexFilter ?? '', isUrlFilterCaseSensitive ? '' : 'i').test(url.href);
}

/** Whether the rules refuse an address: the highest-priority matching rule decides. */
function refuses(rules: readonly Rule[], address: string): boolean {
  const winner = rules
    .filter((rule) => ruleMatches(rule, address))
    .sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1))[0];
  return winner?.action.type === 'block';
}

describe('early-block rules', () => {
  it('refuses the main-frame request of a site a filter blocks, subdomains included', async () => {
    const rules = await build(createStorageData({ filters: [filter('reddit.com')] }));

    expect(rules).toEqual([
      {
        id: 1,
        priority: 1,
        action: { type: 'block' },
        condition: { requestDomains: ['reddit.com'], resourceTypes: ['main_frame'] },
      },
    ]);
    expect(refuses(rules, 'https://old.reddit.com/r/all')).toBe(true);
    expect(refuses(rules, 'https://notreddit.com/')).toBe(false);
  });

  it('writes no rules while snoozed, or for a filter that is off or outside its schedule', async () => {
    const filters = [filter('reddit.com')];
    expect(await build(createStorageData({ filters, snooze: { active: true } }))).toEqual([]);
    expect(
      await build(createStorageData({ filters: [filter('x.com', { enabled: false })] }))
    ).toEqual([]);

    const scheduled = createStorageData({
      groups: [work],
      filters: [filter('reddit.com', { groupId: work.id })],
    });
    expect(await build(scheduled, mondayMorning)).toHaveLength(1);
    expect(await build(scheduled, mondayNight)).toEqual([]);
    expect(await build({ ...scheduled, groups: [{ ...work, enabled: false }] })).toEqual([]);
  });

  it('matches text and whole addresses the way the filters do', async () => {
    const rules = await build(
      createStorageData({
        filters: [
          filter('/Shorts/', { matchMode: 'contains' }),
          filter('a|b', { matchMode: 'contains' }),
          filter('https://Example.com/Page#section', { matchMode: 'exact' }),
          filter('^https://news\\.example/\\d+$', { matchMode: 'regex' }),
        ],
      })
    );

    expect(rules.map((rule) => rule.condition)).toEqual([
      { urlFilter: '/Shorts/', isUrlFilterCaseSensitive: false, resourceTypes: ['main_frame'] },
      { regexFilter: 'a\\|b', isUrlFilterCaseSensitive: false, resourceTypes: ['main_frame'] },
      {
        urlFilter: '|https://example.com/Page|',
        isUrlFilterCaseSensitive: false,
        resourceTypes: ['main_frame'],
      },
      {
        regexFilter: '^https://news\\.example/\\d+$',
        isUrlFilterCaseSensitive: true,
        resourceTypes: ['main_frame'],
      },
    ]);
  });

  it('leaves out a filter that rules cannot express exactly', async () => {
    const data = createStorageData({
      filters: [
        filter('café', { matchMode: 'contains' }),
        filter('#comments', { matchMode: 'contains' }),
        filter('reddit.com/r/popular', { matchMode: 'exact' }),
        filter('[::1]'),
        filter('(unclosed', { matchMode: 'regex' }),
      ],
    });

    expect(await build(data)).toEqual([]);
    // An expression Chrome's rule engine rejects, such as one with a lookahead.
    const lookahead = createStorageData({
      filters: [filter('^(?!https://ok\\.example)', { matchMode: 'regex' })],
    });
    expect(await buildEarlyBlockRules(lookahead, rejectEveryRegex, mondayMorning)).toEqual([]);
  });

  it('lets a group exception through, but not past another group or a temporary block', async () => {
    const data = createStorageData({
      groups: [always, work],
      filters: [
        filter('youtube.com'),
        filter('youtube.com', { id: 'work youtube', groupId: work.id }),
        filter('music.youtube.com', { id: 'temporary', expiresAt: Date.now() + 60_000 }),
      ],
      whitelist: [exception('/watch'), exception('/feed', { groupId: work.id })],
    });
    const rules = await build(data);

    // The work group's filter has no /watch exception, and it outranks the first group's.
    expect(refuses(rules, 'https://youtube.com/watch?v=1')).toBe(true);
    // Its own exception does let /feed through: the navigation handlers block that page as before.
    expect(refuses(rules, 'https://youtube.com/feed')).toBe(false);
    expect(refuses(rules, 'https://music.youtube.com/feed')).toBe(true);

    const outsideWork = await build(data, mondayNight);
    expect(refuses(outsideWork, 'https://youtube.com/watch?v=1')).toBe(false);
    expect(refuses(outsideWork, 'https://youtube.com/feed')).toBe(true);
    expect(refuses(outsideWork, 'https://music.youtube.com/watch?v=1')).toBe(true);
  });

  it('writes no rules for a group with an exception that rules cannot express', async () => {
    const data = createStorageData({
      groups: [always, work],
      filters: [
        filter('youtube.com'),
        filter('reddit.com', { groupId: work.id }),
        filter('news.example', { id: 'temporary', expiresAt: Date.now() + 60_000 }),
      ],
      whitelist: [exception('#music')],
    });

    expect((await build(data)).map((rule) => rule.condition.requestDomains)).toEqual([
      ['reddit.com'],
      ['news.example'],
    ]);
  });

  it('never refuses an address the filters allow', async () => {
    const data = createStorageData({
      groups: [always, work, { ...always, id: 'off', enabled: false }],
      filters: [
        filter('reddit.com'),
        filter('/shorts', { matchMode: 'contains' }),
        filter('https://example.com/exact?q=1', { matchMode: 'exact' }),
        filter('^https://[a-z]+\\.news\\.example/', { matchMode: 'regex', groupId: work.id }),
        filter('youtube.com', { id: 'work youtube', groupId: work.id }),
        filter('x.com', { groupId: 'off' }),
        filter('twitch.tv', { enabled: false }),
        filter('tiktok.com', { id: 'temporary', expiresAt: Date.now() + 60_000 }),
        filter('expired.example', { id: 'expired', expiresAt: Date.now() - 1 }),
      ],
      whitelist: [
        exception('old.reddit.com', { matchMode: 'domain' }),
        exception('/shorts/keep'),
        exception('music.youtube.com', { matchMode: 'domain', groupId: work.id }),
        exception('tiktok.com', { matchMode: 'domain' }),
        exception('/r/learn', { enabled: false }),
      ],
    });
    const addresses = [
      'https://reddit.com/',
      'https://www.reddit.com/r/learn',
      'https://old.reddit.com/r/all',
      'https://notreddit.com/',
      'https://youtube.com/shorts/abc',
      'https://youtube.com/SHORTS/keep',
      'https://youtube.com/watch?v=1',
      'https://music.youtube.com/',
      'https://music.youtube.com/shorts/1',
      'https://example.com/exact?q=1',
      'https://example.com/exact?q=1#top',
      'https://example.com/exact?q=2',
      'https://world.news.example/story',
      'https://world.news.example/Story',
      'https://news.example/story',
      'https://x.com/home',
      'https://twitch.tv/',
      'https://tiktok.com/@someone',
      'https://expired.example/',
      'https://allowed.example/',
    ];

    for (const context of [mondayMorning, mondayNight]) {
      const rules = await build(data, context);
      const engine = createFilteringEngine(data);
      const refused = addresses.filter((address) => refuses(rules, address));
      const blocked = addresses.filter(
        (address) => engine.evaluate(address, { context }).action === 'block'
      );

      expect(refused.filter((address) => !blocked.includes(address))).toEqual([]);
      // Refusing nothing would pass the check above, so the rules must also do their job.
      expect(refused).toContain('https://reddit.com/');
      expect(refused).toContain('https://tiktok.com/@someone');
    }
  });
});
