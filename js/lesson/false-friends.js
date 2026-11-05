/*
 * False friends: English words that look like a word in the class's first
 * language and mean something else. The list is ours, so the AI neither has to
 * find them nor can invent them: buildPrompt tells it which are in the lyrics,
 * and it decides which of those really mislead in their line.
 *
 * A row is [English, look-alike, what the English means, what the look-alike
 * means]. Teachers can read and change this list: add a row, or delete one.
 * English: "a|b" lists other spellings and forms that plain rules would miss;
 * "notice" already covers notices, noticed, noticing and noticin'.
 * The third column is in the class language, the fourth in simple English.
 */
import { normWord } from '../lyrics/text.js';

const CATALAN = [
  // ---- Related words that have grown apart: the classic traps.
  ['actual', 'actual', 'real, veritable', 'current, present'],
  ['actually', 'actualment', 'de fet, en realitat', 'currently, nowadays'],
  ['advertise', 'advertir', 'anunciar', 'to warn'],
  ['advertisement|advert', 'advertiment', 'anunci', 'a warning'],
  ['advice', 'avís', 'consell', 'a warning, a notice'],
  ['advise', 'avisar', 'aconsellar', 'to warn, to let someone know'],
  ['advocate', 'advocat', 'defensor, partidari', 'a lawyer'],
  ['ancient', 'ancià', 'antic', 'an elderly person'],
  ['apology|apologise|apologize', 'apologia', 'disculpa', 'a speech in defence of something'],
  ['argument', 'argument', 'discussió, baralla', 'a reason, the plot of a story'],
  ['assist', 'assistir', 'ajudar', 'to attend, to be present'],
  ['attempt', 'atemptar', 'intentar', 'to carry out an attack'],
  ['attend', 'atendre', 'assistir a', 'to pay attention, to look after'],
  ['bachelor', 'batxiller', 'solter', 'a secondary school graduate'],
  ['billion', 'bilió', 'mil milions', 'a million million'],
  ['camp', 'camp', 'campament', 'a field'],
  ['candid', 'càndid', 'franc, sincer', 'innocent, naive'],
  ['carpet', 'carpeta', 'catifa, moqueta', 'a folder'],
  ['casual|casually', 'casual', 'informal, despreocupat', 'by chance'],
  ['casualty', 'casualitat', 'víctima, baixa', 'a coincidence'],
  ['collar', 'collar', 'coll de camisa', 'a necklace'],
  ['college', 'col·legi', 'universitat, facultat', 'a primary school'],
  ['commodity', 'comoditat', 'producte bàsic', 'comfort'],
  ['comprehensive', 'comprensiu', 'complet, exhaustiu', 'understanding, tolerant'],
  ['compromise', 'compromís', 'acord, cessió mútua', 'a commitment'],
  ['conductor', 'conductor', "director d'orquestra, revisor", 'a driver'],
  ['confidence', 'confidència', 'confiança, seguretat', 'a secret you tell someone'],
  ['confident|confidently', 'confident', 'segur de si mateix', 'a person you tell secrets to'],
  ['constipated', 'constipat', 'restret', 'having a cold'],
  ['contest', 'contestar', 'concurs, competició', 'to answer'],
  ['costume', 'costum', 'disfressa, vestit', 'a custom, a habit'],
  ['data', 'data', 'dades', 'a date on the calendar'],
  ['date', 'dada', 'data, cita', 'a piece of information'],
  ['deceive', 'decebre', 'enganyar', 'to disappoint'],
  ['deception', 'decepció', 'engany', 'disappointment'],
  ['demand', 'demanar', 'exigir', 'to ask for'],
  ['deputy', 'diputat', 'adjunt, substitut', 'a member of parliament'],
  ['dinner', 'dinar', 'sopar', 'lunch'],
  ['discuss', 'discutir', 'parlar de, debatre', 'to argue'],
  ['discussion', 'discussió', 'conversa, debat', 'an argument, a quarrel'],
  ['disgust', 'disgust', 'fàstic', 'upset, sorrow'],
  ['diversion', 'diversió', 'desviació, distracció', 'fun'],
  ['divert', 'divertir', 'desviar', 'to amuse'],
  ['educated', 'educat', 'culte, amb estudis', 'polite, well-mannered'],
  ['embarrass', 'embarassada', 'avergonyir, fer passar vergonya', 'pregnant'],
  ['engaged', 'enganxat', 'promès, ocupat', 'stuck, hooked'],
  ['engine', 'enginy', 'motor', 'wit, cleverness'],
  ['eventual', 'eventual', 'final', 'temporary, possible'],
  ['eventually', 'eventualment', 'finalment, al final', 'possibly, for a time'],
  ['excite', 'excitat', 'il·lusionar, emocionar', 'aroused, agitated'],
  ['exit', 'èxit', 'sortida', 'success'],
  ['fabric', 'fàbrica', 'teixit, tela', 'a factory'],
  ['fabricate', 'fabricar', 'inventar, falsificar', 'to manufacture'],
  ['fastidious', 'fastigós', 'meticulós, primmirat', 'disgusting'],
  ['genial', 'genial', 'afable, cordial', 'brilliant'],
  ['gracious', 'graciós', 'amable, cortès', 'funny'],
  ['hazard', 'atzar', 'perill, risc', 'chance'],
  ['idiom', 'idioma', 'frase feta, expressió', 'a language'],
  ['illusion', 'il·lusió', 'miratge, engany', 'hope, excitement'],
  ['injury', 'injúria', 'ferida, lesió', 'an insult'],
  ['instance', 'instància', 'exemple, cas', 'a written application'],
  ['intend', 'intentar', 'tenir la intenció de', 'to try'],
  ['intoxicated', 'intoxicat', 'borratxo', 'poisoned'],
  ['introduce', 'introduir', 'presentar', 'to put in, to insert'],
  ['journal', 'jornal', 'revista, diari', 'a daily wage'],
  ['journey', 'jornada', 'viatge', 'a working day, a day'],
  ['jubilation', 'jubilació', 'alegria, joia', 'retirement'],
  ['large|larger|largest', 'llarg', 'gran', 'long'],
  ['lecture', 'lectura', 'conferència, classe', 'reading'],
  ['library', 'llibreria', 'biblioteca', 'a bookshop'],
  ['luxury', 'luxúria', 'luxe', 'lust'],
  ['magazine', 'magatzem', 'revista', 'a warehouse'],
  ['mayor', 'major', 'alcalde', 'bigger, older'],
  ['molest', 'molestar', 'agredir sexualment', 'to bother'],
  ['notice', 'notícia', 'adonar-se, avís', 'a piece of news'],
  ['notorious', 'notori', 'de mala fama', 'well known'],
  ['office', 'ofici', 'oficina, despatx', 'a trade, a craft'],
  ['ordinary|ordinarily', 'ordinari', 'normal, corrent', 'vulgar, rude'],
  ['parade', 'parada', 'desfilada', 'a stop, a market stall'],
  ['parcel', 'parcel·la', 'paquet', 'a plot of land'],
  ['parent', 'parents', 'pare o mare', 'relatives'],
  ['patron', 'patró', 'mecenes, client habitual', 'a boss, a pattern'],
  ['pavement', 'paviment', 'vorera', 'a floor surface'],
  ['petrol', 'petroli', 'benzina', 'crude oil'],
  ['phrase', 'frase', 'locució, expressió', 'a sentence'],
  ['physician', 'físic', 'metge', 'a physicist'],
  ['policy', 'policia', 'política, normativa', 'the police'],
  ['precious', 'preciós', 'valuós, estimat', 'beautiful'],
  ['prejudice', 'perjudici', 'prejudici', 'harm, damage'],
  ['preservative', 'preservatiu', 'conservant', 'a condom'],
  ['pretend', 'pretendre', 'fer veure, fingir', 'to aim to, to claim'],
  ['professor', 'professor', 'catedràtic', 'a teacher'],
  ['proper|properly', 'propi', 'adequat, correcte', 'own'],
  ['prove|proven', 'provar', 'demostrar', 'to try, to taste'],
  ['quarrel', 'querella', 'baralla, discussió', 'a lawsuit'],
  ['quote', 'quota', 'cita', 'a fee, a share'],
  ['raisin', 'raïm', 'pansa', 'grapes'],
  ['realize|realise', 'realitzar', 'adonar-se', 'to carry out'],
  ['receipt', 'recepta', 'rebut, tiquet', 'a recipe, a prescription'],
  ['recipient', 'recipient', 'destinatari', 'a container'],
  ['record', 'recordar', 'enregistrar, gravar; disc', 'to remember'],
  ['relief', 'relleu', 'alleujament', 'a relay, a raised shape'],
  ['relieve', 'rellevar', 'alleujar', 'to take over from someone'],
  ['remove', 'remoure', 'treure, eliminar', 'to stir, to move around'],
  ['resort', 'ressort', 'complex turístic; recurs', 'a metal spring'],
  ['resume', 'resumir', 'reprendre', 'to summarise'],
  ['reunion', 'reunió', 'retrobament', 'a meeting'],
  ['robe', 'roba', 'bata, túnica', 'clothes'],
  ['rope', 'roba', 'corda', 'clothes'],
  ['sanity', 'sanitat', 'seny', 'health care'],
  ['scholar', 'escolar', 'erudit, acadèmic', 'a schoolchild'],
  ['senior', 'senyor', 'gran, superior', 'a gentleman, mister'],
  ['sensible|sensibly', 'sensible', 'assenyat', 'sensitive'],
  ['soap', 'sopa', 'sabó', 'soup'],
  ['solicitor', 'sol·licitant', 'advocat', 'an applicant'],
  ['spade', 'espasa', 'pala', 'a sword'],
  ['stamp', 'estampa', 'segell', 'a picture, a print'],
  ['stranger', 'estranger', 'desconegut', 'a foreigner'],
  ['succeed', 'succeir', 'tenir èxit', 'to happen'],
  ['success', 'succés', 'èxit', 'an event'],
  ['suburb', 'suburbi', 'barri residencial', 'a slum'],
  ['support', 'suportar', 'donar suport a', 'to bear, to stand'],
  ['sympathetic', 'simpàtic', 'comprensiu', 'nice, friendly'],
  ['sympathy', 'simpatia', 'compassió, condol', 'friendliness'],
  ['syndicate', 'sindicat', 'consorci', 'a trade union'],
  ['tape', 'tapa', 'cinta', 'a lid'],
  ['target', 'targeta', 'objectiu', 'a card'],
  ['terrific', 'terrífic', 'fantàstic', 'terrifying'],
  ['topic', 'tòpic', 'tema', 'a cliché'],
  ['ultimate', 'últim', 'definitiu, màxim', 'last'],
  ['ultimately', 'últimament', 'al final, en definitiva', 'lately'],
  ['vacancy', 'vacances', 'plaça lliure', 'holidays'],
  ['vague|vaguely', 'vaga', 'imprecís', 'a strike'],
  ['vase', 'vas', 'gerro', 'a drinking glass'],
  ['venture', 'ventura', 'empresa arriscada', 'luck, fortune'],
  ['vest', 'vestit', 'samarreta imperi, armilla', 'a dress, a suit'],
  ['villain', 'vilà', 'dolent', 'a villager'],

  // ---- Words that share one meaning, but not the one the English usually has.
  ['agenda', 'agenda', 'ordre del dia', 'a diary, a planner'],
  ['agony', 'agonia', 'dolor intens, patiment', 'the last moments before death'],
  ['anniversary', 'aniversari', 'aniversari de casament, commemoració', 'a birthday'],
  ['application', 'aplicació', 'sol·licitud', 'an app, hard work'],
  ['assistance', 'assistència', 'ajuda', 'attendance'],
  ['assume', 'assumir', 'suposar', 'to take on a responsibility'],
  ['audience', 'audiència', 'públic', 'a court hearing'],
  ['balance', 'balança', 'equilibri', 'weighing scales'],
  ['career', 'carrera', 'trajectòria professional', 'a degree course, a race'],
  ['character', 'caràcter', 'personatge', 'personality'],
  ['consistent|consistently', 'consistent', 'coherent, constant', 'solid, thick'],
  ['convenient|conveniently', 'convenient', 'pràctic, còmode', 'advisable'],
  ['cry', 'cridar', 'plorar', 'to shout'],
  ['cup', 'copa', 'tassa', 'a wine glass'],
  ['current', 'corrent', 'actual', 'running, ordinary'],
  ['dormitory', 'dormitori', 'habitació col·lectiva', 'a bedroom'],
  ['estate', 'estat', 'finca, propietat', 'a state'],
  ['evidence', 'evidència', 'proves', 'something obvious'],
  ['facility', 'facilitat', 'instal·lació, equipament', 'ease'],
  ['familiar', 'familiar', 'conegut', 'of the family'],
  ['fault', 'falta', 'culpa', 'a mistake, a lack'],
  ['formidable', 'formidable', 'temible, imponent', 'great, wonderful'],
  ['gentle|gently|gentler', 'gentil', 'suau, tendre', 'kind, polite'],
  ['grade', 'grau', 'nota', 'a degree, a step'],
  ['grand|grander', 'gran', 'grandiós', 'big, old'],
  ['ignore', 'ignorar', 'no fer cas de', 'not to know'],
  ['infant', 'infant', 'nadó', 'a child'],
  ['matter', 'matèria', 'importar; assumpte', 'a substance, a school subject'],
  ['miserable|miserably', 'miserable', 'molt trist', 'wretched, mean'],
  ['misery', 'misèria', 'patiment, tristesa', 'poverty'],
  ['money', 'moneda', 'diners', 'a coin, a currency'],
  ['particular', 'particular', 'concret, específic', 'private'],
  ['picture', 'pintura', 'imatge, foto', 'paint, a painting'],
  ['place', 'plaça', 'lloc', 'a town square, a seat'],
  ['prevent', 'prevenir', 'impedir, evitar', 'to warn, to foresee'],
  ['propaganda', 'propaganda', 'propaganda política', 'advertising'],
  ['quiet|quietly', 'quiet', 'silenciós, tranquil', 'still, not moving'],
  ['race', 'raça', 'cursa', 'a breed'],
  ['rare|rarely', 'rar', 'poc freqüent', 'strange'],
  ['relative', 'relatiu', 'familiar, parent', 'not absolute'],
  ['rent', 'renda', 'lloguer', 'income'],
  ['resignation', 'resignació', 'dimissió', 'accepting something bad'],
  ['rest', 'resta', 'descans', 'what is left'],
  ['retire', 'retirar', 'jubilar-se', 'to withdraw'],
  ['rude|rudely', 'rude', 'maleducat', 'rough, coarse'],
  ['sale', 'sala', 'venda, rebaixes', 'a room, a hall'],
  ['scale', 'escala', 'bàscula', 'stairs, a ladder'],
  ['sentence', 'sentència', 'frase', 'a court verdict'],
  ['subject', 'subjecte', 'assignatura, tema', 'the subject of a sentence'],
  ['vicious', 'viciós', 'cruel, ferotge', 'having bad habits'],

  // ---- Unrelated words that only look alike. Often easy words, so they are
  // the first to delete if the prompt gets noisy.
  ['arm', 'arma', 'braç', 'a weapon'],
  ['boat', 'bota', 'vaixell, barca', 'a boot'],
  ['camera', 'cambra', 'càmera', 'a room'],
  ['cap', 'cap', 'gorra', 'a head'],
  ['card', 'carta', 'targeta', 'a letter, a menu'],
  ['cartoon', 'cartró', 'dibuixos animats', 'cardboard'],
  ['cave', 'cava', 'cova', 'sparkling wine'],
  ['curse', 'curs', 'maledicció', 'a course, a school year'],
  ['dent', 'dent', 'abonyegadura', 'a tooth'],
  ['envy', 'enviar', 'enveja', 'to send'],
  ['fame', 'fam', 'fama', 'hunger'],
  ['file', 'fila', 'arxiu, fitxer', 'a row, a queue'],
  ['fill', 'fill', 'omplir', 'a son'],
  ['floor', 'flor', 'terra, pis', 'a flower'],
  ['font', 'font', 'tipus de lletra', 'a fountain, a source'],
  ['fort', 'fort', 'fortalesa', 'strong'],
  ['gent', 'gent', 'senyor', 'people'],
  ['glass', 'glaç', 'got, vidre', 'ice'],
  ['gust', 'gust', 'ràfega', 'a taste, pleasure'],
  ['joke', 'joc', 'broma, acudit', 'a game'],
  ['lent', 'lent', 'va deixar', 'slow'],
  ['mare', 'mare', 'euga', 'a mother'],
  ['mess', 'missa', 'embolic, desordre', 'Mass in church'],
  ['nap', 'nap', 'migdiada', 'a turnip'],
  ['net', 'net', 'xarxa', 'clean, a grandson'],
  ['pal', 'pal', 'amic', 'a stick'],
  ['pan', 'pa', 'paella, cassola', 'bread'],
  ['pit', 'pit', 'forat', 'a chest'],
  ['plate', 'plata', 'plat', 'silver'],
  ['poison', 'poció', 'verí', 'a potion'],
  ['polite|politely', 'polit', 'educat', 'neat, tidy'],
  ['prize', 'preu', 'premi', 'a price'],
  ['sane', 'sa', 'assenyat', 'healthy'],
  ['sang', 'sang', 'va cantar', 'blood'],
  ['sense', 'sense', 'sentit', 'without'],
  ['set', 'set', 'conjunt; posar', 'seven, thirst'],
  ['son', 'son', 'fill', 'sleepiness'],
  ['sort', 'sort', 'tipus, mena', 'luck'],
  ['tall|taller|tallest', 'tall', 'alt', 'a cut, a slice'],
  ['tap', 'tap', 'aixeta, copet', 'a cork, a plug'],
];

// The same test as the notes on the class language in prompt.js.
const LISTS = [[/catal|valenci/i, CATALAN]];

// notice, notices, noticed, noticing. A form nobody sings does no harm here.
function forms(word) {
  const short = /^[^aeiou]*[aeiou][^aeiouwxy]$/.test(word); // tap: tapped, not taped
  const stem = word.endsWith('e') ? word.slice(0, -1) : short ? word + word.slice(-1) : word;
  const y = /[^aeiou]y$/.test(word) ? word.slice(0, -1) + 'i' : '';
  const plural = y ? `${y}es` : /(s|x|z|ch|sh|o)$/.test(word) ? `${word}es` : `${word}s`;
  return [word, plural, y ? `${y}ed` : `${stem}ed`, `${stem}ing`];
}

// Each form that a row answers to, built the first time a list is used.
const indexes = new Map();
export function formsIndex(list) {
  if (!indexes.has(list)) {
    const index = new Map();
    for (const row of list) for (const word of row[0].split('|')) for (const form of forms(word)) index.set(form, row);
    indexes.set(list, index);
  }
  return indexes.get(list);
}

// As the list spells it: "Notice!", "son's" and song English like "noticin'".
const lyricForm = (text) => normWord(text).replace(/'s$/, '').replace(/in'$/, 'ing');

export const friendsList = (language) => LISTS.find(([name]) => name.test(language || ''))?.[1] || null;

/*
 * lines: [{ number, words: ['You', 'noticed'] }], each different line once.
 * -> [{ looksLike, means, looksLikeMeans, spots: [{ line, word }] }], in the
 * order they are first sung. Nothing when the language has no list.
 */
export function findFalseFriends(lines, language) {
  const list = friendsList(language);
  if (!list) return [];
  const index = formsIndex(list);
  const found = new Map();
  for (const { number, words } of lines) {
    for (const word of words) {
      const row = index.get(lyricForm(word));
      if (!row) continue;
      if (!found.has(row)) found.set(row, { looksLike: row[1], means: row[2], looksLikeMeans: row[3], spots: [] });
      const { spots } = found.get(row);
      if (spots[spots.length - 1]?.line !== number) spots.push({ line: number, word });
    }
  }
  return [...found.values()];
}
