// Exit nonzero only when the BAT launcher must run the locked npm installation.
const fs = require('node:fs');
const path = require('node:path');
try {
  const root = path.resolve(__dirname, '..');
  const dependencies = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies;
  for (const [name, version] of Object.entries(dependencies)) {
    const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
    if (installed.version !== version) process.exit(1);
  }
} catch { process.exit(1); }
