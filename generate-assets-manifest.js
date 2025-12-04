const fs = require('fs');
const path = require('path');

const assetsDir = './Assets';
const categories = {};

if (fs.existsSync(assetsDir)) {
  const dirs = fs.readdirSync(assetsDir, { withFileTypes: true })
    .filter(f => f.isDirectory())
    .map(f => f.name);

  for (const dir of dirs) {
    const categoryPath = path.join(assetsDir, dir);
    try {
      const files = fs.readdirSync(categoryPath)
        .filter(f => {
          const ext = path.extname(f).toLowerCase();
          return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
        })
        .map(f => `Assets/${dir}/${f}`)
        .sort();
      if (files.length > 0) {
        categories[dir] = files;
      }
    } catch (_) {}
  }
}

fs.writeFileSync('./assets-manifest.json', JSON.stringify(categories, null, 2));
console.log('Generated assets-manifest.json');
