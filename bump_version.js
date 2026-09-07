const fs = require('fs');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        if (file === 'node_modules' || file === 'dist' || file === '.git' || file === 'brain' || file === '.vscode-test') return;
        file = dir + '/' + file;
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(file));
        } else {
            results.push(file);
        }
    });
    return results;
}

const files = walk('d:/COMU');
let count = 0;
for (const file of files) {
    if (file.endsWith('.vsix') || file.endsWith('.png') || file.endsWith('.lock') || file.endsWith('.jpg') || file.endsWith('.log')) continue;
    try {
        let content = fs.readFileSync(file, 'utf8');
        if (content.includes('0.1.9')) {
            content = content.replace(/0\.1\.8/g, '0.1.9');
            fs.writeFileSync(file, content);
            console.log('Updated ' + file);
            count++;
        }
    } catch (e) {}
}
console.log(`Updated ${count} files to version 0.1.9`);
