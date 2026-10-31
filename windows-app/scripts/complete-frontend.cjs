'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { copyMaterialized } = require('./frontend-files.cjs');

function locate(name, from) {
  const require = createRequire(path.join(from, 'package.json'));
  // Pacotes nativos @img/sharp-* não necessariamente exportam "." ou "./package.json".
  for (const directory of require.resolve.paths(name) || []) {
    const candidate = path.join(directory, ...name.split('/'));
    const stat = fs.lstatSync(candidate, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isSymbolicLink()) throw new Error(`Pacote ${name} ainda usa link/junction. Instale com --config.node-linker=hoisted.`);
    const manifest = path.join(candidate, 'package.json');
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === name) return candidate;
  }
  throw new Error(`Pacote ${name} não localizado a partir de ${from}`);
}

function completeFrontend(root, destination, platform = process.platform, arch = process.arch) {
  const frontend = path.resolve(root);
  const copied = new Set();
  function copy(name, from) {
    const source = locate(name, from);
    const relative = path.relative(frontend, source);
    if (!relative.startsWith('node_modules' + path.sep)) throw new Error(`Dependência ${name} está fora do frontend: ${source}`);
    if (copied.has(source)) return;
    copied.add(source);
    // Reproduzir o layout hoisted existente, inclusive versões aninhadas.
    // Não há reconstrução da árvore .pnpm nem escolha manual de versões/owners.
    copyMaterialized(source, path.join(destination, relative), { excludeNodeModules: true });
    const metadata = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    for (const dependency of Object.keys(metadata.dependencies || {})) copy(dependency, source);
    if (name === 'sharp') {
      const variant = platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime ? 'linuxmusl' : platform;
      copy(`@img/sharp-${variant}-${arch}`, source);
      const vips = `@img/sharp-libvips-${variant}-${arch}`;
      if (metadata.optionalDependencies?.[vips]) copy(vips, source);
    }
  }
  for (const name of ['next', 'react', 'react-dom']) copy(name, frontend);
  copy('sharp', locate('next', frontend));
  return copied.size;
}
if (require.main === module) {
  try {
    console.log('Pacotes de runtime conferidos:', completeFrontend(path.resolve(__dirname, '../../frontend'), path.resolve(__dirname, '../staging/frontend')));
  } catch (error) { console.error(`[complete-frontend] ${error.message}`); process.exitCode = 1; }
}
module.exports = { completeFrontend, locate };
