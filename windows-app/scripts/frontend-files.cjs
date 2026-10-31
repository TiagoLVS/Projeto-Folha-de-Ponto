'use strict';
const fs = require('node:fs');
const path = require('node:path');

function privateName(name) {
  const normalized = name.toLowerCase();
  return normalized.startsWith('.env') || ['.git', '.secrets', 'email.key', 'banco.bin'].includes(normalized);
}

/** O workflow instala hoisted: copiar arquivos reais, nunca seguir ou recriar junctions. */
function copyMaterialized(source, destination, { excludeNodeModules = false } = {}) {
  const root = path.resolve(source);
  const target = path.resolve(destination);
  const relative = path.relative(root, target);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('O staging não pode ficar dentro da origem.');
  }
  const filter = entry => {
    const parts = path.relative(root, entry).split(path.sep).filter(Boolean);
    if (parts.some(privateName) || (excludeNodeModules && parts.includes('node_modules'))) return false;
    // lstat não segue o link, inclusive se o alvo estiver quebrado/inacessível.
    const stat = fs.lstatSync(entry);
    if (stat.isSymbolicLink()) throw new Error(`Link/junction inesperado: ${entry}. Reinstale o frontend com --config.node-linker=hoisted antes do build.`);
    if (!stat.isDirectory() && !stat.isFile()) throw new Error(`Entrada não suportada no standalone: ${entry}`);
    return true;
  };
  try {
    fs.cpSync(root, target, { recursive: true, dereference: false, force: true, filter });
    assertMaterialized(target);
  } catch (error) {
    throw new Error(`Falha ao copiar a árvore hoisted ${root} em ${target}: ${error.message}`, { cause: error });
  }
}

function assertMaterialized(root) {
  function visit(entry) {
    const stat = fs.lstatSync(entry);
    if (stat.isSymbolicLink()) throw new Error(`Link/junction residual no staging: ${entry}`);
    if (privateName(path.basename(entry))) throw new Error(`Arquivo privado encontrado no staging: ${entry}`);
    if (stat.isDirectory()) for (const name of fs.readdirSync(entry)) visit(path.join(entry, name));
  }
  visit(path.resolve(root));
}
module.exports = { copyMaterialized, assertMaterialized, privateName };
