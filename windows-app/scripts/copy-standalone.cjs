'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { copyMaterialized } = require('./frontend-files.cjs');
const { completeFrontend } = require('./complete-frontend.cjs');

function copyStandalone(source, destination, frontend, { platform = process.platform, arch = process.arch } = {}) {
  if (!fs.existsSync(path.join(source, 'server.js'))) throw new Error(`server.js ausente em ${source}. Execute o build standalone.`);
  if (fs.existsSync(destination)) throw new Error(`O destino deve estar vazio: ${destination}`);
  console.log('[standalone] Materializando os links/junctions do pnpm…');
  copyMaterialized(source, destination);
  const packages = completeFrontend(frontend, destination, platform, arch);
  console.log(`[standalone] ${packages} pacotes complementados; validando o staging isolado…`);
  const check = spawnSync(process.execPath, [path.join(__dirname, 'validate-frontend.cjs'), destination, platform, arch], {
    cwd: destination, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', NODE_ENV: 'production' }, stdio: 'inherit',
  });
  if (check.error) throw new Error(`Não foi possível iniciar a validação: ${check.error.message}`);
  if (check.status !== 0) throw new Error(`Dependências do standalone inválidas (validação terminou com código ${check.status}).`);
}
if (require.main === module) {
  try {
    const [source, destination, frontend, platform = process.platform, arch = process.arch] = process.argv.slice(2);
    if (!source || !destination || !frontend) throw new Error('Uso: copy-standalone.cjs origem destino frontend [plataforma arquitetura]');
    copyStandalone(path.resolve(source), path.resolve(destination), path.resolve(frontend), { platform, arch });
  } catch (error) { console.error(`[copy-standalone] ${error.message}`); process.exitCode = 1; }
}
module.exports = { copyStandalone };
