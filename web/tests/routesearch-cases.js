// Route search golden cases (core/routesearch.js): the queries web/tests/routesearch-golden.json answers. The iOS Kit
// test (RouteSearchTests.swift) reads the same golden file. Add a query here, then run tools/gen_routesearch_golden.py.

/** Queries (owner's examples first: 53rdst / 53rd St -> 53rd Street). */
export const CASES = [
  "53rdst", "53rd st", "53 st", "53rd street", "53", "53rd", "53r", "53rd s", "53st", "fifty third", "Fifty-Third Street",
  "metra", "red line", "red ln", "arts", "arts block", "ap/dx", "AP / DX", "apostolic drexel", "apostolic", "ap", "dx",
  "dcc", "downtown", "dt", "downtown campus", "sth loop", "south loop", "s loop", "south", "drexl", "drexel", "drexle",
  "ratner", "ratnr", "regenstein", "57th drexel", "e", "s", "n", "north", "east", "cen", "central", "ctr", "friend ctr",
  "fcm", "mm", "midway", "re", "reg", "regents exp", "regents express", "sls", "move in", "charter", "garfield",
  "hospital", "logan center", "uchicago medicine", "kimbark", "street", "Ellis/57th", "hyde park", "comer",
  "lab school", "red", "west", "nroth", "xyz", "", "   ", "the", "&", "1st", "61st st", "constructor", "toString",
];

/** routeWords(s, typing) cases (normalization, letters split from digits, ordinals, number words, stopwords). */
export const WORD_CASES = [
  ["53rdst", true], ["53rd St.", false], ["53 rd", true], ["53r", true], ["53r", false], ["53st", true], ["57th", false],
  ["Ellis/57th", false], ["AP/DX", false], ["Friend Center/Metra", false], ["S. Hyde Park Blvd/55th Street", false],
  ["Ronald McDonald House & Friend Center", false], ["Comer Children's Hospital", false], ["Café Médici", false],
  ["fifty third", true], ["Fifty-Third", false], ["twenty", false], ["nineteenth", false], ["route53", false],
  ["e53rd", false], ["007", false], ["111th", false], ["112th", false], ["2nd", false], ["2th", false], ["11st", false],
  ["the", false], ["the east", false], ["Institute for Study of Ancient Cultures", false], ["  ", false],
];
