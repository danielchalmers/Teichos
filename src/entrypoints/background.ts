import { defineBackground } from 'wxt/utils/define-background';

import { registerBackground } from '../background';

export default defineBackground({
  type: 'module',
  main() {
    registerBackground();
  },
});
