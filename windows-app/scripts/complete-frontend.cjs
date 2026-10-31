'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { copyMaterialized } = require('./frontend-files.cjs');

function locate(name, from) {
  const require = createRequire(path.join(from, 'package.json'));
  // Alguns binários @img/sharp-* não exportam "." nem "./package.json".
  // A ferramenta de montagem pode ler o manifesto pelo mesmo caminho de busca do Node.
  for (const directory of require.resolve.paths(name) || []) {
    const candidate = path.join(directory, ...name.split('/'));
    const manifest = path.join(candidate, 'package.json');
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === name) return fs.realpathSync(candidate);
  }
  throw new Error(`Pacote ${name} não localizado a partir de ${from}`);
}

function completeFrontend(root, destination, platform = process.platform, arch = process.arch) {
  const versions = new Map();
  // Mantém os contextos de resolução. Versões diferentes ficam aninhadas no pacote que as utiliza.
  // Assim não se força uma versão única para todas as dependências do pnpm.
  function copy(name, from, owner) {
    const source = locate(name, from);
    const metadata = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    const nodeModules = path.join(destination, 'node_modules');
    let target = path.join(nodeModules, ...name.split('/'));
    if (owner) {
      try {
        const existing = locate(name, owner);
        if (path.resolve(existing).startsWith(path.resolve(destination) + path.sep)
          && JSON.parse(fs.readFileSync(path.join(existing, 'package.json'), 'utf8')).version === metadata.version) target = existing;
        else target = path.join(owner, 'node_modules', ...name.split('/'));
      } catch { target = path.join(owner, 'node_modules', ...name.split('/')); }
    }
    const key = path.resolve(target);
    if (versions.has(key)) {
      if (versions.get(key) !== metadata.version) throw new Error(`Versões incompatíveis em ${target}`);
      return;
    }
    versions.set(key, metadata.version);
    copyMaterialized(source, target, { excludeNodeModules: true });
    for (const dependency of Object.keys(metadata.dependencies || {})) copy(dependency, source, target);
    // O loader do sharp usa estes nomes dinamicamente; o tracing não é suficiente.
    if (name === 'sharp') {
      const variant = platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime ? 'linuxmusl' : platform;
      copy(`@img/sharp-${variant}-${arch}`, source, target);
      const vips = `@img/sharp-libvips-${variant}-${arch}`;
      if (metadata.optionalDependencies?.[vips]) copy(vips, source, target);
    }
  }
  for (const name of ['next', 'react', 'react-dom']) copy(name, root);
  copy('sharp', locate('next', root));
  return versions.size;
}
if (require.main === module) {
  try {
    console.log('Pacotes de runtime conferidos:', completeFrontend(path.resolve(__dirname, '../../frontend'), path.resolve(__dirname, '../staging/frontend')));
  } catch (error) { console.error(`[complete-frontend] ${error.message}`); process.exitCode = 1; }
}
module.exports = { completeFrontend, locate };
