// Spelling correction ("did you mean"), nicknames, the searchPlaces {exact, assumed} contract, idle preload,
// and the UChicago destination table over the real data/places.json (data/spell.js, data/places.js, data/geocode.js).
import { test, eq, ok } from './lib.js';
import { distance, maxEdits, buildVocab, corrections, known } from '../js/data/spell.js';
import { setPlaces, searchLocal, findLocal, loadPlaces, preloadPlaces, placesReady } from '../js/data/places.js';
import { searchPlaces, clearPlaceCache, mergePlaces, localPlaces } from '../js/data/geocode.js';
import { res, stubFetch, sleep } from './data-helpers.js';

const NO_PLACES = { stops: [], p: [] };
/** Small campus fixture; p[8] = other names (OSM alt names + tools/place_aliases.json nicknames). */
const CAMPUS = { stops: ['Regenstein Library (N)', 'Booth School', '57th Street Metra Station (E)'], p: [
  ['Joseph Regenstein Library', 'Library', '1100 E 57th St', 41.7922, -87.5999, 0, 1, 'library', ['Regenstein Library', 'Regenstein', 'The Reg', 'Reg']],
  ['Joe and Rika Mansueto Library', 'Library', '1100 E 57th St', 41.792, -87.6008, 0, 1, 'library', ['Mansueto Library', 'Mansueto']],
  ['Harper Memorial Library', 'Library', '1116 E 59th St', 41.788, -87.5996, 1, 2, 'university', ['Harper Library', 'Harper']],
  ['Harper Court', 'Retail', '', 41.8001, -87.5879, 2, 1, 'retail'],
  ['Max Palevsky Commons Central', 'Dorm', '', 41.7929, -87.5998, 0, 2, 'dormitory', ['Max P', 'Max Palevsky']],
  ['Regents Park Apartments', 'Apartments', '5020 S Lake Shore Dr', 41.8, -87.58, 2, 9, 'apartments'],
  ['Seminary Co-op Bookstore', 'Bookstore', '5751 S Woodlawn Ave', 41.79013, -87.59608, 1, 1, 'books', ['Sem Co-op', 'Co-op Bookstore']],
  ['John Crerar Library', 'Library', '5730 S Ellis Ave', 41.7905, -87.6028, 0, 1, 'library', ['Crerar Library', 'Crerar']],
  ['Chicago Fire Department Engine Company 50', 'Fire station', '5000 S Union Ave', 41.80326, -87.6433, 2, 21, 'fire station'],
] };
const feat = (name, lon, lat) => ({ geometry: { coordinates: [lon, lat] }, properties: { name, countrycode: 'US', state: 'Illinois', city: 'Chicago' } });

test('spell: weighted Damerau-Levenshtein (swaps, vowels, doubled letters, neighbouring keys cost less)', () => {
  eq(distance('palvesky', 'palevsky'), { cost: 0.6, edits: 1 }, 'swapped letters');
  eq(distance('regensteen', 'regenstein'), { cost: 0.7, edits: 1 }, 'vowel for vowel');
  eq(distance('mansuetto', 'mansueto'), { cost: 0.5, edits: 1 }, 'doubled letter');
  eq(distance('regenstwin', 'regenstein'), { cost: 0.6, edits: 1 }, 'w is next to e');
  eq(distance('crear', 'crerar').edits, 1, 'missing letter');
  eq(distance('regnstien', 'regenstein').edits, 2);
  eq(distance('abcd', 'wxyz').edits, Infinity, 'gives up beyond the limit');
  eq([3, 4, 5, 6, 12].map(maxEdits), [0, 1, 1, 2, 2], 'no correction under 4 letters, 1 edit for 4-5, 2 for longer');
});

test('spell: corrections only touch unknown words; splits / merges; never numbers; "loop" is not "coop"', () => {
  const v = buildVocab(['joseph regenstein library', 'regenstein', 'max palevsky commons', 'sem co op', 'co op bookstore', 'coop', 'harper court']);
  ok(known(v, 'regens') && known(v, 'max') && !known(v, 'regenstien'), 'a word or the start of one is known');
  const c1 = corrections(v, ['regenstien'])[0];
  eq([c1.words, c1.big], [['regenstein'], false], 'one swap: small');
  eq(corrections(v, ['regnstien'])[0].big, true, 'two edits in a word: big');
  eq(corrections(v, ['max', 'palvesky'])[0].words, ['max', 'palevsky'], 'only the unknown word changes');
  ok(corrections(v, ['regen', 'stien']).some((c) => c.words.join(' ') === 'regenstein' && c.big), 'extra space removed (big)');
  ok(corrections(v, ['harpercourt']).some((c) => c.words.join(' ') === 'harper court' && c.big), 'missing space added (big)');
  eq(corrections(v, ['5801']), [], 'numbers are never corrected');
  ok(!corrections(v, ['loop']).some((c) => c.words.includes('coop')), 'short word: no plain edit on the first letter');
  eq(corrections(v, ['reg']), [], 'under 4 letters: no correction');
});

test('places: nicknames are names ("Reg", "Max P", "Harper"), the real name still wins an exact tie', () => {
  setPlaces(CAMPUS);
  eq(searchLocal('reg')[0].label, 'Joseph Regenstein Library', 'nickname beats "Regents Park" prefix');
  eq(searchLocal('max p')[0].label, 'Max Palevsky Commons Central');
  eq(searchLocal('maxp')[0].label, 'Max Palevsky Commons Central', 'spaces ignored');
  eq(searchLocal('harper')[0].label, 'Harper Memorial Library');
  eq(searchLocal('harper court')[0].label, 'Harper Court');
  eq(searchLocal('sem coop')[0].label, 'Seminary Co-op Bookstore');
  setPlaces(NO_PLACES);
});

test('places: a small correction (one letter) is used silently, a long stretch is flagged big', () => {
  setPlaces(CAMPUS);
  const small = findLocal('regenstien');
  eq(small.items[0].label, 'Joseph Regenstein Library');
  eq(small.assumed, { from: 'regenstien', to: 'Regenstein', big: false });
  eq(findLocal('crear').assumed, { from: 'crear', to: 'Crerar', big: false });
  eq(findLocal('mansuetto').items[0].label, 'Joe and Rika Mansueto Library');
  eq(findLocal('Regnstien').assumed, { from: 'Regnstien', to: 'Regenstein', big: true }, '2 edits in a word');
  const two = findLocal('harpr libary');
  eq([two.items[0].label, two.assumed.to, two.assumed.big], ['Harper Memorial Library', 'Harper Library', true], 'two words changed');
  eq(findLocal('regen stien').assumed, { from: 'regen stien', to: 'Regenstein', big: true }, 'space removed + typo, shown as the name');
  setPlaces(NO_PLACES);
});

test('places: no correction for strong matches, exact mode, numbers or unknown short words', () => {
  setPlaces(CAMPUS);
  eq(findLocal('regenstein').assumed, undefined);
  eq(findLocal('regen stein').assumed, undefined, 'letters match a name exactly: not a correction');
  const ex = findLocal('regenstien', { exact: true });
  eq([ex.assumed, ex.items.length], [undefined, 0], 'exact: as typed, no typo tolerance');
  eq(findLocal('loop').items, [], 'loop stays loop (Photon can find the Loop)');
  eq(findLocal('5801 s ellis').assumed, undefined);
  eq(findLocal('x').items, [], 'under 2 letters');
  setPlaces(NO_PLACES);
});

test('geocode: searchPlaces returns {items, assumed}; Photon gets the corrected text, never more', async () => {
  clearPlaceCache();
  setPlaces(CAMPUS);
  const f = stubFetch(() => res({ features: [feat('Regenstein Library', -87.6, 41.7925), feat('Regenstein Elephant House', -87.633, 41.92)] }));
  const out = await searchPlaces('regnstien', { fetch: f });
  eq(out.assumed, { from: 'regnstien', to: 'Regenstein', big: true });
  eq(new URL(f.calls[0].url).searchParams.get('q'), 'Regenstein', 'corrected text sent');
  eq(out.items.map((x) => x.label), ['Joseph Regenstein Library', 'Regenstein Elephant House'], 'local first, same-place Photon twin merged');
  const plain = await searchPlaces('harper court', { fetch: stubFetch(() => res({ features: [] })) });
  ok(!('assumed' in plain), 'no assumed key without a correction');
  setPlaces(NO_PLACES);
  clearPlaceCache();
});

test('geocode: exact search is comprehensive: typed text, Photon even with 5+ local matches, up to 8', async () => {
  clearPlaceCache();
  setPlaces({ stops: ['A'], p: Array.from({ length: 6 }, (_, i) => ['Pizza place ' + i, 'Restaurant', '', 41.79, -87.6, 0, i + 1, 'pizza']) });
  const body = { features: [0, 1, 2, 3, 4].map((i) => feat('Pizzeria ' + i, -87.62 - i * 0.01, 41.88)) };
  const f = stubFetch(() => res(body));
  eq((await searchPlaces('pizza', { fetch: f })).items.length, 5);
  eq(f.calls.length, 0, 'normal search: answered on the device');
  const ex = await searchPlaces('pizza', { fetch: f, exact: true });
  eq([f.calls.length, new URL(f.calls[0].url).searchParams.get('q')], [1, 'pizza']);
  eq(ex.items.length, 8, '5 local + 3 Photon');
  ok(!('assumed' in ex));
  eq(localPlaces('pizza').items.length, 5, 'localPlaces: synchronous on-device results');
  setPlaces(NO_PLACES);
  clearPlaceCache();
});

test('geocode: mergePlaces lists category / address-only local matches after Photon', () => {
  const local = [{ label: 'Chicago Fire Department Engine Company 50', lat: 41.803, lon: -87.643, score: 65, local: true }];
  const remote = [{ label: 'Union Station', lat: 41.8786, lon: -87.6403 }];
  eq(mergePlaces(local, remote).map((x) => x.label), ['Union Station', 'Chicago Fire Department Engine Company 50']);
  const strong = [{ label: 'Harper Court', lat: 41.8, lon: -87.588, score: 100, local: true }];
  eq(mergePlaces(strong, remote).map((x) => x.label), ['Harper Court', 'Union Station']);
});

test('places: a load still in flight never overwrites data set meanwhile', async () => {
  setPlaces(null);
  let release;
  const slow = () => new Promise((r) => { release = () => r(res({ stops: ['X'], p: [['Wrong Place', 'Cafe', '', 41.79, -87.6, 0, 1, 'cafe']] })); });
  const p = loadPlaces(slow);
  await sleep(0);
  setPlaces(CAMPUS);
  release();
  await p;
  eq(searchLocal('wrong'), [], 'stale load ignored');
  eq(searchLocal('reg')[0].label, 'Joseph Regenstein Library');
  setPlaces(NO_PLACES);
});

test('places: preloadPlaces fetches once in idle time after load, so the first search is instant', async () => {
  setPlaces(null);
  ok(!placesReady() && localPlaces('reg') === null, 'not loaded yet: localPlaces says so (null)');
  const f = stubFetch(() => res(CAMPUS));
  preloadPlaces({ fetch: f, delay: 10 });
  preloadPlaces({ fetch: f, delay: 10 });
  for (let i = 0; i < 100 && !placesReady(); i++) await sleep(20);
  ok(placesReady(), 'index built');
  eq(f.calls.length, 1, 'fetched once');
  eq(localPlaces('reg').items[0].label, 'Joseph Regenstein Library', 'answers synchronously');
  setPlaces(NO_PLACES);
});

/** UChicago destinations: query -> expected first result on the real data/places.json (nicknames + misspellings). */
const UCHICAGO = [
  ["regenstein", "Joseph Regenstein Library"], ["reg", "Joseph Regenstein Library"], ["the reg", "Joseph Regenstein Library"],
  ["regenstien", "Joseph Regenstein Library"], ["regenstein library", "Joseph Regenstein Library"], ["regen stien", "Joseph Regenstein Library"],
  ["mansueto", "Joe and Rika Mansueto Library"], ["mansuetto", "Joe and Rika Mansueto Library"], ["harper library", "Harper Memorial Library"],
  ["harper", "Harper Memorial Library"], ["harpr libary", "Harper Memorial Library"], ["crerar", "John Crerar Library"],
  ["crear", "John Crerar Library"], ["eckhart library", "Eckhart Library"], ["d'angelo", "D'Angelo Law Library"],
  ["law library", "D'Angelo Law Library"], ["max p", "Max Palevsky Commons Central"], ["maxp", "Max Palevsky Commons Central"],
  ["max palevsky", "Max Palevsky Commons Central"], ["max palvesky", "Max Palevsky Commons Central"], ["palevksy", "Max Palevsky Commons Central"],
  ["campus north", "Campus North Residential Commons"], ["cn", "Campus North Residential Commons"], ["wrc", "Woodlawn Residential & Dining Commons"],
  ["woodlawn commons", "Woodlawn Residential & Dining Commons"], ["south campus", "Renee Granville-Grossman Residential Commons"],
  ["rgg", "Renee Granville-Grossman Residential Commons"], ["burton judson", "Burton-Judson Courts"], ["bj", "Burton-Judson Courts"],
  ["snell hitchcock", "Snell-Hitchcock Halls"], ["i-house", "International House"], ["ihouse", "International House"],
  ["international house", "International House"], ["cathey", "Arley D. Cathey Dining Commons"], ["cathy", "Arley D. Cathey Dining Commons"],
  ["baker", "Baker Dining Commons"], ["bartlett", "Bartlett Dining Commons"], ["bart mart", "Bartlett Dining Commons"],
  ["reynolds club", "Reynolds Club"], ["ida noyes", "Ida Noyes Hall"], ["hutch", "Hutchinson Commons"], ["hutchinson commons", "Hutchinson Commons"],
  ["rocky", "Rockefeller Memorial Chapel"], ["rockefeller chapel", "Rockefeller Memorial Chapel"], ["rockefeler", "Rockefeller Memorial Chapel"],
  ["bond chapel", "Bond Chapel"], ["logan center", "Logan Center for the Arts"], ["logan centre", "Logan Center for the Arts"],
  ["smart museum", "David and Alfred Smart Museum of Art"], ["smart musuem", "David and Alfred Smart Museum of Art"],
  ["isac", "Institute for the Study of Ancient Cultures Museum"], ["oriental institute", "Institute for the Study of Ancient Cultures Museum"],
  ["oi", "Institute for the Study of Ancient Cultures Museum"], ["booth", "Charles M. Harper Center"], ["harper center", "Charles M. Harper Center"],
  ["law school", "Laird Bell Law Quadrangle"], ["saieh", "Saieh Hall for Economics"], ["kptc", "Kersten Physics Teaching Center"],
  ["kersten physics", "Kersten Physics Teaching Center"], ["erc", "William Eckhardt Research Center"],
  ["gcis", "Gordon Center for Integrative Science"], ["ratner", "Ratner Athletic Center"], ["henry crown", "Henry Crown Field House"],
  ["uchicago", "The University of Chicago"], ["ucmc", "University of Chicago Medicine Campus"],
  ["medical center", "University of Chicago Medicine Campus"], ["comer", "Comer Children's Hospital"],
  ["mitchell hospital", "Bernard A. Mitchell Hospital"], ["dcam", "Duchossois Center for Advanced Medicine"],
  ["pritzker", "Donnelley Biological Sciences Learning Center"], ["ellis garage", "Campus North Parking Garage"], ["polsky", "Polsky Exchange North"],
  ["harper court", "Harper Court"], ["57th street metra", "55th-56th-57th Street"], ["57th metra", "55th-56th-57th Street"],
  ["59th street metra", "59th Street (University of Chicago)"], ["garfield red line", "Garfield (Red Line)"],
  ["museum of science and industry", "Griffin Museum of Science and Industry"], ["msi", "Griffin Museum of Science and Industry"],
  ["robie house", "Frederick C. Robie House"], ["seminary co-op", "Seminary Co-op Bookstore"], ["midway", "Midway Plaisance"],
  ["the point", "Promontory Point"], ["promontory point", "Promontory Point"], ["medici", "Medici on 57th"], ["chipotle", "Chipotle"],
  ["chipolte", "Chipotle"], ["trader joes", "Trader Joe's"], ["whole foods", "Whole Foods Market"], ["target", "Target"], ["starbucks", "Starbucks"],
  ["insomnia cookies", "Insomnia"], ["jewel osco", "Jewel-Osco"], ["cvs", "CVS Pharmacy"],
];

test('places: every UChicago destination query returns the right place first (real data/places.json)', async () => {
  setPlaces(null);
  ok(await loadPlaces(), 'data/places.json loaded');
  const wrong = [];
  for (const [q, want] of UCHICAGO) {
    const got = findLocal(q).items[0]?.label;
    if (got !== want) wrong.push(`${q} -> ${got} (want ${want})`);
  }
  eq(wrong, [], `${UCHICAGO.length} queries`);
  ok(UCHICAGO.length >= 60);
  setPlaces(NO_PLACES);
});
