import { parseSuggestedStats, STAT_FALLBACK } from './statSuggestionService.js';

console.log('Testing parseSuggestedStats...');

// Test 1: clean JSON is parsed correctly
console.log('Test 1: clean JSON response...');
const out1 = parseSuggestedStats('{"might": 5, "magic": 1, "mischief": 1}');
if (out1.might !== 5) {
  throw new Error(`Expected might 5, got ${out1.might}`);
}
if (out1.magic !== 1) {
  throw new Error(`Expected magic 1, got ${out1.magic}`);
}
if (out1.mischief !== 1) {
  throw new Error(`Expected mischief 1, got ${out1.mischief}`);
}
console.log(`- might: ${out1.might}, magic: ${out1.magic}, mischief: ${out1.mischief} ✓`);

// Test 2: JSON embedded in prose is extracted
console.log('Test 2: JSON embedded in prose...');
const out2 = parseSuggestedStats('Here are the stats: {"might": 1, "magic": 5, "mischief": 1} based on the wizard class.');
if (out2.magic !== 5) {
  throw new Error(`Expected magic 5, got ${out2.magic}`);
}
if (out2.might !== 1) {
  throw new Error(`Expected might 1, got ${out2.might}`);
}
console.log(`- magic: ${out2.magic} ✓`);

// Test 3: <think> blocks are stripped before parsing
console.log('Test 3: <think> blocks stripped...');
const out3 = parseSuggestedStats('<think>A rogue relies on cunning...</think>\n{"might": 1, "magic": 1, "mischief": 5}');
if (out3.mischief !== 5) {
  throw new Error(`Expected mischief 5, got ${out3.mischief}`);
}
if (out3.might !== 1) {
  throw new Error(`Expected might 1, got ${out3.might}`);
}
console.log(`- mischief: ${out3.mischief} ✓`);

// Test 4: float values are rounded
console.log('Test 4: float values are rounded...');
const out4 = parseSuggestedStats('{"might": 2.7, "magic": 1.2, "mischief": 3.5}');
if (out4.might !== 3) {
  throw new Error(`Expected might 3 (rounded from 2.7), got ${out4.might}`);
}
if (out4.magic !== 1) {
  throw new Error(`Expected magic 1 (rounded from 1.2), got ${out4.magic}`);
}
if (out4.mischief !== 4) {
  throw new Error(`Expected mischief 4 (rounded from 3.5), got ${out4.mischief}`);
}
console.log(`- might: ${out4.might}, magic: ${out4.magic}, mischief: ${out4.mischief} ✓`);

// Test 5: values above 5 are clamped to 5
console.log('Test 5: values clamped to max 5...');
const out5 = parseSuggestedStats('{"might": 99, "magic": 1, "mischief": 1}');
if (out5.might !== 5) {
  throw new Error(`Expected might clamped to 5, got ${out5.might}`);
}
console.log(`- might clamped: ${out5.might} ✓`);

// Test 6: values below 1 are clamped to 1
console.log('Test 6: values clamped to min 1...');
const out6 = parseSuggestedStats('{"might": -3, "magic": 0, "mischief": 3}');
if (out6.might !== 1) {
  throw new Error(`Expected might clamped to 1, got ${out6.might}`);
}
if (out6.magic !== 1) {
  throw new Error(`Expected magic clamped to 1, got ${out6.magic}`);
}
console.log(`- might: ${out6.might}, magic: ${out6.magic} ✓`);

// Test 7: empty string returns fallback
console.log('Test 7: empty string returns fallback...');
const out7 = parseSuggestedStats('');
if (out7.might !== STAT_FALLBACK.might) {
  throw new Error(`Expected fallback might ${STAT_FALLBACK.might}, got ${out7.might}`);
}
if (out7.magic !== STAT_FALLBACK.magic) {
  throw new Error(`Expected fallback magic ${STAT_FALLBACK.magic}, got ${out7.magic}`);
}
if (out7.mischief !== STAT_FALLBACK.mischief) {
  throw new Error(`Expected fallback mischief ${STAT_FALLBACK.mischief}, got ${out7.mischief}`);
}
console.log(`- fallback: ${JSON.stringify(out7)} ✓`);

// Test 8: invalid JSON returns fallback
console.log('Test 8: invalid JSON returns fallback...');
const out8 = parseSuggestedStats('not json at all');
if (out8.might !== STAT_FALLBACK.might) {
  throw new Error(`Expected fallback, got ${JSON.stringify(out8)}`);
}
console.log(`- fallback: ${JSON.stringify(out8)} ✓`);

// Test 9: malformed JSON returns fallback
console.log('Test 9: malformed JSON returns fallback...');
const out9 = parseSuggestedStats('{might: 3, magic: 2, mischief: 2}');
if (out9.might !== STAT_FALLBACK.might) {
  throw new Error(`Expected fallback, got ${JSON.stringify(out9)}`);
}
console.log(`- fallback: ${JSON.stringify(out9)} ✓`);

// Test 10: missing fields fall back to their individual defaults
console.log('Test 10: missing fields use per-stat defaults...');
const out10 = parseSuggestedStats('{"might": 4}');
if (out10.might !== 4) {
  throw new Error(`Expected might 4, got ${out10.might}`);
}
if (out10.magic !== STAT_FALLBACK.magic) {
  throw new Error(`Expected magic fallback ${STAT_FALLBACK.magic}, got ${out10.magic}`);
}
if (out10.mischief !== STAT_FALLBACK.mischief) {
  throw new Error(`Expected mischief fallback ${STAT_FALLBACK.mischief}, got ${out10.mischief}`);
}
console.log(`- might: ${out10.might}, magic: ${out10.magic}, mischief: ${out10.mischief} ✓`);

// Test 11: string numbers in JSON are coerced
console.log('Test 11: string numbers are coerced...');
const out11 = parseSuggestedStats('{"might": "3", "magic": "2", "mischief": "2"}');
if (out11.might !== 3) {
  throw new Error(`Expected might 3, got ${out11.might}`);
}
if (out11.magic !== 2) {
  throw new Error(`Expected magic 2, got ${out11.magic}`);
}
console.log(`- might: ${out11.might}, magic: ${out11.magic} ✓`);

// Test 12: multi-line <think> block followed by JSON
console.log('Test 12: multi-line think block stripped...');
const out12 = parseSuggestedStats(`<think>
This character is a rogue.
Rogues rely on cunning.
Therefore mischief should be highest.
</think>
{"might": 2, "magic": 1, "mischief": 4}`);
if (out12.mischief !== 4) {
  throw new Error(`Expected mischief 4, got ${out12.mischief}`);
}
if (out12.magic !== 1) {
  throw new Error(`Expected magic 1, got ${out12.magic}`);
}
console.log(`- mischief: ${out12.mischief} ✓`);

console.log('\nAll statSuggestionService tests passed!');
