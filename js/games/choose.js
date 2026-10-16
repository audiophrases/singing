/*
 * Choose the word: Fill the gaps with three options for every gap.
 */
import { start as gapfill } from './gapfill.js';

export function start(ctx) {
  return gapfill(ctx, { input: 'choose', level: 'easy' });
}
