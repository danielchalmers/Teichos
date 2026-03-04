import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('popup snooze quick durations', () => {
  it('includes 1d and 3d quick duration options', () => {
    const popupHtml = readFileSync(resolve(process.cwd(), 'src/popup/index.html'), 'utf8');

    expect(popupHtml).toContain('data-snooze-minutes="1440">1d</button>');
    expect(popupHtml).toContain('data-snooze-minutes="4320">3d</button>');
  });
});
