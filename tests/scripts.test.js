// Every inline <script> in every page must parse. A broken script silently kills every button on that page.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('every inline script block in src/*.html is valid JavaScript', () => {
  const dir = path.join(__dirname, '..', 'src');
  const problems = [];
  fs.readdirSync(dir).filter(f => f.endsWith('.html')).forEach(f => {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    blocks.forEach((body, i) => {
      const js = body.replace(/<\?!?=?[\s\S]*?\?>/g, '0');   // template scriptlets become a harmless literal
      try { new vm.Script(js, { filename: `${f}#${i}` }); }
      catch (e) { problems.push(`${f} script #${i}: ${e.message}`); }
    });
  });
  assert.deepEqual(problems, []);
});
