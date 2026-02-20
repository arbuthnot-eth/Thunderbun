const fs = require('fs');
const path = require('path');

function replaceInFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;
    
    // Replace Thunderview -> Thunderview
    content = content.replace(/Thunderview/g, 'Thunderview');
    content = content.replace(/thunderview/g, 'thunderview');
    
    // Replace ThunderBun -> Thunderbun
    content = content.replace(/ThunderBun/g, 'ThunderBun'); // wait, the project uses ThunderBun or Thunderbun? Let's use Thunderbun
    content = content.replace(/thunderbun/g, 'thunderbun');

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('Updated: ' + filePath);
    }
}

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fullPath.includes('node_modules') || fullPath.includes('.git') || fullPath.includes('vendors') || fullPath.includes('.lock')) {
            continue;
        }
        
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            walkDir(fullPath);
        } else if (stat.isFile()) {
            // only process text files
            const ext = path.extname(fullPath);
            if (['.ts', '.js', '.html', '.css', '.md', '.json', '.h', '.cpp', '.cc', '.mm', '.zig', '.txt', '.yml', '.yaml'].includes(ext) || ext === '') {
                try {
                    replaceInFile(fullPath);
                } catch(e) {
                    // skip binaries or unreadable
                }
            }
        }
    }
}

walkDir('.');
