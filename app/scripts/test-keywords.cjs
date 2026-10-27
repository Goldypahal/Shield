// Checks which spoken phrases start a voice SOS. Run from app/: node scripts/test-keywords.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '../src/services/emergencyKeywords.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', js)(mod, mod.exports);
const { matchEmergency } = mod.exports;

// [said, final?, should start an SOS?]
const cases = [
  // distress phrases, anywhere, as whole words
  ['help', true, true], ['Help me!', false, true], ['please help', true, true], ['someone help us', true, true],
  ['save me', true, true], ['bachao', true, true], ['mujhe bachao', false, true], ['madad karo', true, true],
  ['let me go', true, true], ['बचाओ', true, true], ['मदद करो', true, true],
  // guarded words said as a cry
  ['stop', true, true], ['Stop!', true, true], ['stop it', true, true], ['stop stop', true, true],
  ['stop it now please', true, true], ['police', true, true], ['police police', true, true],
  ['call the police', true, true], ['someone call the police', true, true], ['police help', true, true],
  ['emergency', true, true], ['this is an emergency', true, true], ['stop touching me', true, true],
  ["don't touch me", true, true], ['पुलिस बुलाओ', true, true],
  // everyday speech that must NOT start an SOS
  ['bus stop', true, false], ['the next stop is sector 17', true, false], ['stop by the shop later', true, false],
  ['that was helpful', true, false], ['I saved the file', true, false], ['police station is near', true, false],
  ['the police came yesterday', true, false], ['emergency exit on the left', true, false],
  ['I watched an emergency room show', true, false], ['we talked about the police', true, false],
  ['helpline number', true, false], ['stopwatch', true, false], ['', true, false],
  // partial results: guarded words wait for the final result
  ['stop', false, false], ['police', false, false], ['call the police', false, false],
];

let fail = 0;
for (const [said, final, want] of cases) {
  const got = matchEmergency(said, final);
  const ok = (got !== null) === want;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(said)}${final ? '' : ' (partial)'} -> ${got ?? 'no SOS'}`);
}
console.log(fail ? `\n${fail} failing` : `\nall ${cases.length} cases pass`);
process.exit(fail ? 1 : 0);
