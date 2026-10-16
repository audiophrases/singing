/*
 * Word lists the lyric tools lean on: frequency, function words, irregular
 * verbs and topic sets (animals, colours...). Plain data, no logic.
 */

// Roughly the 700 most frequent English words, most frequent first.
export const COMMON = `the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is was are were been has had did said made went got saw came took knew thought told became left felt found gave
man woman child children world life hand part place case week company system program question government number night point home water room mother area money story fact month lot right study book eye job word business issue side kind head house service friend father power hour game line end member law car city community name president team minute idea kid body information school face others level office door health person art war history party result change morning reason research girl guy moment air teacher force education foot boy age policy everything process music market sense nation plan college interest death experience effect class control care field development role effort rate heart drug show leader light voice wife police mind price report decision son view relationship town road arm difference value building action model season society tax director position player record paper space ground form event official matter center couple site project activity star table need court oil situation cost industry figure street image phone data picture practice piece land product doctor wall patient worker news test movie north love support technology step baby computer type attention film tree source organization hair window evidence population truth song
see find tell ask seem feel try leave call keep let begin help talk turn start show hear play run move live believe hold bring happen write provide sit stand lose pay meet include continue set learn change lead understand watch follow stop create speak read allow add spend grow open walk win offer remember love consider appear buy wait serve die send expect build stay fall cut reach kill remain suggest raise pass sell require report decide pull eat sleep drink sing dance swim fly jump climb cry laugh smile wash cook draw clean ride drive catch throw kick
good new first last long great little own other old right big high different small large next early young important few public bad same able best better sure free true whole real hard full special easy clear recent certain personal open red difficult available likely short single medical current wrong private past foreign fine common poor natural significant similar hot dead central happy serious ready simple left physical general environmental financial blue democratic dark various entire close legal religious cold final main green nice huge popular traditional cultural white black yellow brown pink purple orange grey gray sad tired hungry angry funny silly pretty beautiful ugly fast slow tall loud quiet soft warm cool sweet lovely crazy busy lucky
very often always never sometimes usually still again too here there today tomorrow yesterday tonight soon later already almost really maybe away together around down off much more less both each every many such own once twice please thank thanks yes hello goodbye bye sorry okay oh hey`.split(/\s+/).filter(Boolean);

const rank = new Map();
COMMON.forEach((w, i) => { if (!rank.has(w)) rank.set(w, i); });

// 0 = very common ... Infinity = not in the list.
export function frequencyRank(word) {
  const w = String(word || '').toLowerCase();
  if (rank.has(w)) return rank.get(w);
  // Simple inflections share their base word's rank.
  for (const base of [w.replace(/'s$/, ''), w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ed$/, ''), w.replace(/d$/, ''), w.replace(/ing$/, ''), w.replace(/ing$/, 'e'), w.replace(/ies$/, 'y'), w.replace(/ied$/, 'y')]) {
    if (base !== w && rank.has(base)) return rank.get(base) + 50;
  }
  return Infinity;
}

export const STOPWORDS = new Set(`a an the and or but so if then than that this these those to of in on at by for with from as is am are was were be been being do does did have has had i you he she it we they me him her us them my your his its our their mine yours ours theirs not no yes oh ah la na hey ooh yeah uh um`.split(/\s+/));

// [base, past, past participle]
export const IRREGULAR_VERBS = [
  ['be', 'was', 'been'], ['be', 'were', 'been'], ['beat', 'beat', 'beaten'], ['become', 'became', 'become'], ['begin', 'began', 'begun'],
  ['bend', 'bent', 'bent'], ['bet', 'bet', 'bet'], ['bite', 'bit', 'bitten'], ['bleed', 'bled', 'bled'], ['blow', 'blew', 'blown'],
  ['break', 'broke', 'broken'], ['bring', 'brought', 'brought'], ['build', 'built', 'built'], ['burn', 'burnt', 'burnt'], ['buy', 'bought', 'bought'],
  ['catch', 'caught', 'caught'], ['choose', 'chose', 'chosen'], ['come', 'came', 'come'], ['cost', 'cost', 'cost'], ['cut', 'cut', 'cut'],
  ['dig', 'dug', 'dug'], ['do', 'did', 'done'], ['draw', 'drew', 'drawn'], ['dream', 'dreamt', 'dreamt'], ['drink', 'drank', 'drunk'],
  ['drive', 'drove', 'driven'], ['eat', 'ate', 'eaten'], ['fall', 'fell', 'fallen'], ['feed', 'fed', 'fed'], ['feel', 'felt', 'felt'],
  ['fight', 'fought', 'fought'], ['find', 'found', 'found'], ['fly', 'flew', 'flown'], ['forget', 'forgot', 'forgotten'], ['forgive', 'forgave', 'forgiven'],
  ['freeze', 'froze', 'frozen'], ['get', 'got', 'got'], ['give', 'gave', 'given'], ['go', 'went', 'gone'], ['grow', 'grew', 'grown'],
  ['hang', 'hung', 'hung'], ['have', 'had', 'had'], ['hear', 'heard', 'heard'], ['hide', 'hid', 'hidden'], ['hit', 'hit', 'hit'],
  ['hold', 'held', 'held'], ['hurt', 'hurt', 'hurt'], ['keep', 'kept', 'kept'], ['know', 'knew', 'known'], ['lay', 'laid', 'laid'],
  ['lead', 'led', 'led'], ['learn', 'learnt', 'learnt'], ['leave', 'left', 'left'], ['lend', 'lent', 'lent'], ['let', 'let', 'let'],
  ['lie', 'lay', 'lain'], ['light', 'lit', 'lit'], ['lose', 'lost', 'lost'], ['make', 'made', 'made'], ['mean', 'meant', 'meant'],
  ['meet', 'met', 'met'], ['pay', 'paid', 'paid'], ['put', 'put', 'put'], ['quit', 'quit', 'quit'], ['read', 'read', 'read'],
  ['ride', 'rode', 'ridden'], ['ring', 'rang', 'rung'], ['rise', 'rose', 'risen'], ['run', 'ran', 'run'], ['say', 'said', 'said'],
  ['see', 'saw', 'seen'], ['seek', 'sought', 'sought'], ['sell', 'sold', 'sold'], ['send', 'sent', 'sent'], ['set', 'set', 'set'],
  ['shake', 'shook', 'shaken'], ['shine', 'shone', 'shone'], ['shoot', 'shot', 'shot'], ['show', 'showed', 'shown'], ['shut', 'shut', 'shut'],
  ['sing', 'sang', 'sung'], ['sink', 'sank', 'sunk'], ['sit', 'sat', 'sat'], ['sleep', 'slept', 'slept'], ['slide', 'slid', 'slid'],
  ['speak', 'spoke', 'spoken'], ['spend', 'spent', 'spent'], ['spin', 'spun', 'spun'], ['stand', 'stood', 'stood'], ['steal', 'stole', 'stolen'],
  ['stick', 'stuck', 'stuck'], ['sting', 'stung', 'stung'], ['strike', 'struck', 'struck'], ['swear', 'swore', 'sworn'], ['sweep', 'swept', 'swept'],
  ['swim', 'swam', 'swum'], ['swing', 'swung', 'swung'], ['take', 'took', 'taken'], ['teach', 'taught', 'taught'], ['tear', 'tore', 'torn'],
  ['tell', 'told', 'told'], ['think', 'thought', 'thought'], ['throw', 'threw', 'thrown'], ['understand', 'understood', 'understood'], ['wake', 'woke', 'woken'],
  ['wear', 'wore', 'worn'], ['weep', 'wept', 'wept'], ['win', 'won', 'won'], ['write', 'wrote', 'written'], ['spill', 'spilt', 'spilt'],
  ['smell', 'smelt', 'smelt'], ['spell', 'spelt', 'spelt'], ['dive', 'dove', 'dived'], ['wind', 'wound', 'wound'], ['bear', 'bore', 'born'],
];

export const IRREGULAR_PAST = new Map();
export const IRREGULAR_PP = new Map();
export const IRREGULAR_BASE = new Map();
for (const [base, past, pp] of IRREGULAR_VERBS) {
  if (!IRREGULAR_PAST.has(past)) IRREGULAR_PAST.set(past, base);
  if (!IRREGULAR_PP.has(pp)) IRREGULAR_PP.set(pp, base);
  if (!IRREGULAR_BASE.has(base)) IRREGULAR_BASE.set(base, [past, pp]);
}

// Words ending in -ed / -ing that are not verb forms.
export const NOT_ED = new Set('red bed fed led shed sled need seed feed speed bleed breed weed wed bred bread dead head lead read thread spread ahead instead sacred hundred wicked naked rugged ragged crooked beloved kindred shed shred tired'.split(' '));
export const NOT_ING = new Set('thing things king ring rings sing sings bring spring string wing wings swing sting nothing something anything everything morning evening ceiling during pudding wedding darling earring building'.split(' '));

export const PRONOUNS = new Set('i you he she it we they me him her us them my your his its our their mine yours hers ours theirs myself yourself himself herself itself ourselves themselves'.split(' '));
export const PREPOSITIONS = new Set('in on at under over through with from to into onto by across behind between above below near around down up off out for of about without inside outside along against among before after beside beyond past toward towards upon within till until like'.split(' '));
export const DETERMINERS = new Set('a an the this that these those some any every each no another other such what which whose'.split(' '));
export const MODALS = new Set("can could will would shall should may might must can't couldn't won't wouldn't shouldn't mustn't i'll you'll he'll she'll we'll they'll it'll i'd you'd he'd she'd we'd they'd".split(' '));
export const QWORDS = new Set('what where when why who whom whose which how'.split(' '));
export const CONJUNCTIONS = new Set('and but or so because if when while although though since unless until than then'.split(' '));
export const NUMBERS = new Set('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million first second third fourth fifth sixth seventh eighth ninth tenth once twice'.split(' '));
export const COLOURS = new Set('red blue green yellow orange purple pink brown black white grey gray gold golden silver violet'.split(' '));
export const ANIMALS = new Set('cat cats dog dogs cow cows pig pigs duck ducks sheep horse horses lamb lambs bird birds fish lion lions tiger tigers bear bears monkey monkeys elephant elephants giraffe giraffes zebra snake snakes mouse mice rabbit rabbits frog frogs fox owl owls bee bees spider spiders hen chicken chickens goat goats donkey crocodile shark whale dolphin penguin kangaroo butterfly ant ants wolf deer camel parrot turtle weasel goose moose'.split(' '));
export const BODY = new Set('head heads shoulder shoulders knee knees toe toes eye eyes ear ears mouth nose hand hands foot feet leg legs arm arms finger fingers thumb face hair back tummy neck teeth tooth heart spine chin lips'.split(' '));
export const FAMILY = new Set('mother mum mom mummy mama father dad daddy papa brother brothers sister sisters baby babies grandma grandpa granny grandmother grandfather uncle aunt cousin son daughter family parents children child wife husband'.split(' '));
export const FOOD = new Set('apple apples banana bananas bread cake cheese chocolate milk tea coffee water juice pizza pasta rice egg eggs meat chicken fish soup salad sandwich lunch breakfast dinner sugar butter ice cream orange oranges grapes carrot carrots potato potatoes tomato tomatoes biscuit cookie lemonade honey jam porridge buns'.split(' '));
export const WEATHER = new Set('sun sunny rain rainy raining snow snowy snowing wind windy cloud clouds cloudy storm stormy hot cold warm cool fog foggy weather sky rainbow thunder lightning'.split(' '));
export const TIME_WORDS = new Set('monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december spring summer autumn fall winter morning afternoon evening night day days week weeks month year today tomorrow yesterday tonight'.split(' '));
export const CLOTHES = new Set('hat hats shoe shoes sock socks shirt t-shirt dress skirt trousers jeans coat jacket scarf gloves boots cap jumper sweater'.split(' '));
export const FEELINGS = new Set('happy sad angry tired sleepy hungry thirsty scared afraid bored excited silly worried nervous proud lonely glad fine ok okay'.split(' '));
export const ADJECTIVES = new Set(`good bad big little small large tall short long old new young happy sad angry tired sleepy hungry silly funny crazy lovely beautiful pretty ugly nice kind mean rich poor hot cold warm cool high low fast slow loud quiet soft hard easy difficult strong weak heavy light dark bright clean dirty full empty open closed wet dry sweet sour fresh great wonderful terrible awful amazing fair true false free busy lucky lazy brave clever smart fat thin wide deep shallow gentle wild strange real right wrong merry jolly white black red blue green yellow brown pink purple orange grey golden blazing fine sure sick dear excited bored scared proud glad lonely ready own whole only`.split(/\s+/));
export const ACTION_VERBS = new Set('jump run walk clap stomp dance sing swim fly climb hop skip spin turn wave shake nod point touch sit stand sleep wake eat drink cry laugh smile kick throw catch push pull roll wash brush cook read write draw paint play stretch'.split(' '));
export const CONTRACTIONS = new Map([
  ["i'm", 'i am'], ["you're", 'you are'], ["he's", 'he is'], ["she's", 'she is'], ["it's", 'it is'], ["we're", 'we are'], ["they're", 'they are'],
  ["i've", 'i have'], ["you've", 'you have'], ["we've", 'we have'], ["they've", 'they have'], ["i'll", 'i will'], ["you'll", 'you will'],
  ["he'll", 'he will'], ["she'll", 'she will'], ["we'll", 'we will'], ["they'll", 'they will'], ["it'll", 'it will'], ["i'd", 'i would'],
  ["don't", 'do not'], ["doesn't", 'does not'], ["didn't", 'did not'], ["can't", 'cannot'], ["won't", 'will not'], ["isn't", 'is not'],
  ["aren't", 'are not'], ["wasn't", 'was not'], ["weren't", 'were not'], ["haven't", 'have not'], ["hasn't", 'has not'], ["couldn't", 'could not'],
  ["wouldn't", 'would not'], ["shouldn't", 'should not'], ["let's", 'let us'], ["that's", 'that is'], ["there's", 'there is'], ["what's", 'what is'],
  ["where's", 'where is'], ["who's", 'who is'], ["here's", 'here is'], ["o'er", 'over'], ["'cause", 'because'], ["gonna", 'going to'], ["wanna", 'want to'],
]);

// Families of rhyming words (for rhyme games and sound-alike distractors).
export const RHYME_FAMILIES = [
  'cat hat bat mat rat sat fat flat that',
  'day play say way stay may away today grey pay',
  'star car far are guitar jar bar',
  'night light bright right kite high fly sky why my eye bye',
  'tree see me be free sea three knee bee we',
  'go know snow slow show so no toe grow',
  'you do two blue new shoe zoo too true who',
  'town down brown clown crown frown',
  'ring sing king thing bring wing spring swing',
  'bed red head said bread fed led',
  'fun run sun one done gun won',
  'cake make take lake bake wake snake shake',
  'ball call fall tall wall all small',
  'boat coat goat float note',
  'hand band land sand stand',
  'mouse house',
  'fish dish wish',
  'dog frog log jog fog',
  'bear chair hair there where air pair',
  'moon soon spoon noon June',
  'cold old gold told hold',
  'door four more floor shore roar',
  'farm arm warm',
  'late eight great gate plate wait',
  'phone own home alone bone stone',
  'kite night white bite',
  'pen ten hen men when again then',
  'feet street meet sweet eat',
  'heart start part art',
  'rain train again plain brain',
  'friend end send bend',
  'song long strong wrong along',
  'dream stream scream cream team',
  'hive five dive alive drive',
  'sticks six kicks tricks',
  'spine nine line fine mine shine',
  'thumb drum come some',
  'laugh giraffe half',
];

const FAMILY_OF = new Map();
RHYME_FAMILIES.forEach((fam, i) => { for (const w of fam.split(' ')) if (!FAMILY_OF.has(w)) FAMILY_OF.set(w, i); });

export function rhymeFamily(word) {
  const i = FAMILY_OF.get(String(word || '').toLowerCase());
  return i === undefined ? null : RHYME_FAMILIES[i].split(' ');
}
