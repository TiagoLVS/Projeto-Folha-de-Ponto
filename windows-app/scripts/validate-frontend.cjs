'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { assertMaterialized } = require('./frontend-files.cjs');
const { locate } = require('./complete-frontend.cjs');

async function validateFrontend(folder, platform = process.platform, arch = process.arch) {
  const root = fs.realpathSync(folder);
  if (!fs.statSync(path.join(root, 'server.js')).isFile()) throw new Error('server.js ausente no staging.');
  assertMaterialized(root);
  function internal(file, name) {
    const real = fs.realpathSync(file);
    const relative = path.relative(root, real);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error(`${name} foi resolvido fora do pacote (${real}); dependência na máquina de build não é permitida.`);
    }
    return real;
  }
  const require = createRequire(path.join(root, 'package.json'));
  for (const name of ['next', 'react', 'react-dom', 'react-dom/server']) {
    try {
      const resolved = internal(require.resolve(name), name);
      require(name);
      console.log(`[standalone] ${name}: ${path.relative(root, resolved)}`);
    } catch (error) { throw new Error(`Dependência crítica ${name} ausente ou inválida: ${error.message}`, { cause: error }); }
  }
  const reactDOM = createRequire(path.join(locate('react-dom', root), 'package.json'));
  if (internal(reactDOM.resolve('react'), 'react-dom -> react') !== internal(require.resolve('react'), 'react')) {
    throw new Error('React e react-dom usam cópias distintas de React no staging.');
  }
  const nextRoot = internal(locate('next', root), 'next');
  const nextRequire = createRequire(path.join(nextRoot, 'package.json'));
  // Importações dinâmicas de runtime que não aparecem sempre no tracing do build.
  for (const name of ['@swc/helpers/_/_interop_require_default', 'styled-jsx/style', 'sharp']) {
    internal(nextRequire.resolve(name), name);
  }
  const visited = new Set();
  function dependencies(name, owner) {
    const directory = internal(locate(name, owner), name);
    if (visited.has(directory)) return;
    visited.add(directory);
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    for (const dependency of Object.keys(metadata.dependencies || {})) {
      try { dependencies(dependency, directory); }
      catch (error) { throw new Error(`${name}@${metadata.version} requer ${dependency}: ${error.message}`, { cause: error }); }
    }
    const context = createRequire(path.join(directory, 'package.json'));
    for (const peer of Object.keys(metadata.peerDependencies || {})) {
      if (!metadata.peerDependenciesMeta?.[peer]?.optional) internal(context.resolve(peer), `${name} -> peer ${peer}`);
    }
  }
  for (const name of ['next', 'react', 'react-dom', 'sharp']) dependencies(name, root);
  if (platform !== process.platform || arch !== process.arch) {
    throw new Error(`Sharp precisa ser validado em ${platform}/${arch}; este processo é ${process.platform}/${process.arch}. Execute o empacotamento no runner Windows x64.`);
  }
  const sharp = nextRequire('sharp');
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).resize(1, 1).png().toBuffer();
  if (!image.length || !sharp.versions.vips) throw new Error('Sharp/libvips não executou a operação de imagem.');
  const natives = Object.keys(require.cache).filter(file => file.endsWith('.node'));
  if (!natives.length) throw new Error('Nenhum módulo nativo do sharp foi carregado.');
  for (const file of natives) internal(file, 'binário nativo');
  console.log(`[standalone] sharp/libvips ${sharp.versions.vips}: operação nativa OK (${platform}/${arch}); ${visited.size} pacotes de runtime validados.`);
  return { packages: visited.size, natives };
}
if (require.main === module) {
  const [folder, platform = process.platform, arch = process.arch] = process.argv.slice(2);
  validateFrontend(path.resolve(folder || '.'), platform, arch).catch(error => {
    console.error(`[validate-frontend] ${error.message}`); process.exitCode = 1;
  });
}
module.exports = { validateFrontend };
