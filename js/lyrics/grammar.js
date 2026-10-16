/*
 * A small, honest grammar spotter for song lyrics. It works from word lists
 * and endings, so it is right most of the time - the hunt game lets the
 * teacher fix any word it gets wrong with a click.
 */
import {
  IRREGULAR_PAST, IRREGULAR_PP, IRREGULAR_BASE, NOT_ED, NOT_ING, PRONOUNS, PREPOSITIONS, DETERMINERS, MODALS, QWORDS,
  NUMBERS, COLOURS, ANIMALS, BODY, FAMILY, FOOD, WEATHER, TIME_WORDS, CLOTHES, FEELINGS, ADJECTIVES, ACTION_VERBS, CONTRACTIONS,
  frequencyRank,
} from './wordlists.js';

function isRegularPast(w) {
  return w.length >= 4 && /ed$/.test(w) && !NOT_ED.has(w);
}

function isIng(w) {
  return w.length > 4 && /ing$/.test(w) && !NOT_ING.has(w);
}

function isComparative(w) {
  if (/^(more|less|most|least|better|best|worse|worst)$/.test(w)) return true;
  const m = /^(.+?)(er|est)$/.exec(w);
  if (!m) return false;
  const base = m[1];
  const cands = [base, `${base}e`, base.replace(/i$/, 'y'), base.replace(/(.)\1$/, '$1')];
  return cands.some((c) => ADJECTIVES.has(c));
}

function isPlural(w) {
  if (w.length < 4 || !/s$/.test(w) || /(ss|us|is|'s)$/.test(w)) return false;
  const base = w.replace(/ies$/, 'y').replace(/(ches|shes|xes|ses)$/, (x) => x.slice(0, -2)).replace(/s$/, '');
  return ANIMALS.has(base) || BODY.has(base) || FAMILY.has(base) || FOOD.has(base) || CLOTHES.has(base)
    || /^(bell|star|friend|song|word|thing|day|year|bar|tree|flower|light|dream|eye|car|bus|wheel|wiper|door|baby|people|child|kid|boat|stick|bone|hand)s?$/.test(base);
}

export const CATEGORIES = [
  { id: 'past', name: 'Past simple verbs', emoji: '⏪', test: (w) => IRREGULAR_PAST.has(w) || isRegularPast(w) },
  { id: 'ing', name: '-ing words', emoji: '🔄', test: isIng },
  { id: 'irregular', name: 'Irregular verbs (any form)', emoji: '🌀', test: (w) => IRREGULAR_PAST.has(w) || IRREGULAR_PP.has(w) || (IRREGULAR_BASE.has(w) && w.length > 2 && w !== 'be') },
  { id: 'pronoun', name: 'Pronouns', emoji: '👤', test: (w) => PRONOUNS.has(w) },
  { id: 'preposition', name: 'Prepositions', emoji: '📍', test: (w) => PREPOSITIONS.has(w) && w !== 'like' && w !== 'to' },
  { id: 'article', name: 'Articles (a, an, the)', emoji: '🅰️', test: (w) => w === 'a' || w === 'an' || w === 'the' },
  { id: 'determiner', name: 'Determiners (this, some, every...)', emoji: '👉', test: (w) => DETERMINERS.has(w) && !/^(a|an|the|what|which|whose)$/.test(w) },
  { id: 'modal', name: 'Modal verbs (can, will, should...)', emoji: '🛠️', test: (w) => MODALS.has(w) },
  { id: 'question', name: 'Question words', emoji: '❓', test: (w) => QWORDS.has(w) },
  { id: 'contraction', name: 'Contractions (I\'m, don\'t...)', emoji: '✂️', test: (w) => CONTRACTIONS.has(w) || /n't$|'(m|re|s|ll|ve|d)$/.test(w) },
  { id: 'negative', name: 'Negatives', emoji: '🚫', test: (w) => /^(not|no|never|nothing|nobody|none|nowhere)$/.test(w) || /n't$/.test(w) },
  { id: 'comparative', name: 'Comparatives and superlatives', emoji: '📈', test: isComparative },
  { id: 'adjective', name: 'Adjectives', emoji: '🎨', test: (w) => ADJECTIVES.has(w) || FEELINGS.has(w) || COLOURS.has(w) },
  { id: 'plural', name: 'Plural nouns', emoji: '👯', test: isPlural },
  { id: 'number', name: 'Numbers', emoji: '🔢', test: (w) => NUMBERS.has(w) || /^\d+$/.test(w) },
  { id: 'colour', name: 'Colours', emoji: '🌈', test: (w) => COLOURS.has(w) },
  { id: 'animal', name: 'Animals', emoji: '🐾', test: (w) => ANIMALS.has(w) },
  { id: 'body', name: 'Body parts', emoji: '🦵', test: (w) => BODY.has(w) },
  { id: 'family', name: 'Family', emoji: '👨‍👩‍👧', test: (w) => FAMILY.has(w) },
  { id: 'food', name: 'Food and drink', emoji: '🍎', test: (w) => FOOD.has(w) },
  { id: 'weather', name: 'Weather and nature', emoji: '⛅', test: (w) => WEATHER.has(w) },
  { id: 'time', name: 'Time words (days, months...)', emoji: '📅', test: (w) => TIME_WORDS.has(w) },
  { id: 'clothes', name: 'Clothes', emoji: '👕', test: (w) => CLOTHES.has(w) },
  { id: 'feeling', name: 'Feelings', emoji: '😀', test: (w) => FEELINGS.has(w) },
  { id: 'action', name: 'Action verbs', emoji: '🤸', test: (w) => ACTION_VERBS.has(w) },
];

export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

export function wordInCategory(norm, catId) {
  const c = categoryById(catId);
  return !!c && !!norm && c.test(norm);
}

// Which categories have at least `min` words in the song? Most frequent first.
export function categoriesInTimeline(timeline, min = 2) {
  const counts = new Map();
  for (const l of timeline.lines) {
    for (const w of l.words) {
      const norm = normalize(w.text);
      for (const c of CATEGORIES) if (c.test(norm)) counts.set(c.id, (counts.get(c.id) || 0) + 1);
    }
  }
  return CATEGORIES.filter((c) => (counts.get(c.id) || 0) >= min)
    .map((c) => ({ ...c, count: counts.get(c.id) }))
    .sort((a, b) => b.count - a.count);
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[‘’]/g, "'").replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
}

// Base form of a verb, for distractors and quizzes ("went" -> "go").
export function baseForm(w) {
  if (IRREGULAR_PAST.has(w)) return IRREGULAR_PAST.get(w);
  if (IRREGULAR_PP.has(w)) return IRREGULAR_PP.get(w);
  const known = (c) => Number.isFinite(frequencyRank(c)) || ACTION_VERBS.has(c) || IRREGULAR_BASE.has(c);
  let stem = null;
  if (/ied$/.test(w)) return w.replace(/ied$/, 'y');
  if (/ed$/.test(w)) stem = w.slice(0, -2);
  else if (/ing$/.test(w) && w.length > 4) stem = w.slice(0, -3);
  if (stem === null) return w;
  const cands = [stem, `${stem}e`, /([^aeiou])\1$/.test(stem) ? stem.slice(0, -1) : null].filter(Boolean);
  return cands.find(known) || (/([^aeiou])\1$/.test(stem) ? stem.slice(0, -1) : stem);
}

export function pastOf(base) {
  if (IRREGULAR_BASE.has(base)) return IRREGULAR_BASE.get(base)[0];
  if (/e$/.test(base)) return `${base}d`;
  if (/[^aeiou]y$/.test(base)) return base.replace(/y$/, 'ied');
  if (/^[^aeiou]*[aeiou][bdgmnpt]$/.test(base)) return `${base}${base.slice(-1)}ed`;
  return `${base}ed`;
}
