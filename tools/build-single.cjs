// Bundles the game into one self-contained HTML file (scripts, styles and
// fonts inlined) for sharing or embedding.
//
//   node tools/build-single.cjs            -> dist/the-last-bell.html
//   node tools/build-single.cjs --fragment -> dist/the-last-bell.fragment.html
//
// The fragment variant omits <!doctype>/<html>/<head>/<body> so it can be
// dropped into a host page that supplies its own document skeleton.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const fragment = process.argv.includes('--fragment');

let html = read('index.html');
let css = read('css/style.css').replace(/url\('\.\.\/assets\/fonts\/([^']+)'\)/g, (_, file) => {
  const b64 = fs.readFileSync(path.join(root, 'assets/fonts', file)).toString('base64');
  return `url(data:font/ttf;base64,${b64})`;
});
html = html.replace('<link rel="stylesheet" href="css/style.css">', () => `<style>\n${css}\n</style>`);
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, src) => {
  const js = read(src);
  if (/<\/script/i.test(js)) throw new Error(`${src} contains a closing script tag`);
  return `<script>\n${js}\n</script>`;
});

if (fragment) {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)[1]
    .replace(/<meta charset[^>]*>\s*/, '')
    .replace(/<meta name="viewport"[^>]*>\s*/, '');
  const body = /<body>([\s\S]*?)<\/body>/.exec(html)[1];
  html = head.trim() + '\n' + body.trim() + '\n';
}

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, fragment ? 'the-last-bell.fragment.html' : 'the-last-bell.html');
fs.writeFileSync(out, html);
console.log(`${path.relative(root, out)} ${(html.length / 1024).toFixed(0)} KB`);
