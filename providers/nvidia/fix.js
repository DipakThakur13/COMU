const fs = require('fs');
let files = ['src/index.ts', 'src/catalog.ts'];
for (const f of files) {
  if (fs.existsSync(f)) {
    let c = fs.readFileSync(f, 'utf8');
    c = c.replace(/\\\`/g, '`');
    c = c.replace(/\\\$/g, '$');
    c = c.replace(/\\\\n/g, '\\n');
    fs.writeFileSync(f, c);
  }
}
