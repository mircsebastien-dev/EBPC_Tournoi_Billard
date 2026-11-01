const fs = require('fs');
const code = fs.readFileSync(process.argv[2], 'utf8');
const script = [...code.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const lines = script.split('\n');
const startFn = parseInt(process.argv[3] || '138') - 1;
for (let end = startFn + 1; end <= lines.length; end++) {
  const chunk = lines.slice(startFn, end).join('\n') + '\n}';
  try { new Function(chunk); console.log('OK jusqu\'à ligne', end); process.exit(0); } catch (e) {}
}
console.log('jamais OK');
