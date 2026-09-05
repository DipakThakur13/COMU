const fs = require('fs');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        if (file === 'node_modules' || file === 'dist' || file === '.git' || file === 'brain') return;
        file = dir + '/' + file;
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(file));
        } else {
            if (file.endsWith('package.json')) results.push(file);
        }
    });
    return results;
}

const files = walk('d:/COMU');
for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    if (content.includes('"version": "0.1.6"')) {
        content = content.replace(/"version": "0.1.6"/g, '"version": "0.1.7"');
        fs.writeFileSync(file, content);
        console.log('Updated ' + file);
    }
}
