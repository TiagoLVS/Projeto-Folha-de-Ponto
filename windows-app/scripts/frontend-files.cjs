'use strict';
const fs = require('node:fs');
const path = require('node:path');

function privateName(name) {
  const normalized = name.toLowerCase();
  return normalized.startsWith('.env') || ['.git', '.secrets', 'email.key', 'banco.bin'].includes(normalized);
}

/** Uma única política para standalone e complementação: materializar, nunca recriar links. */
function copyMaterialized(source, destination, { excludeNodeModules = false } = {}) {
  const root = path.resolve(source);
  const target = path.resolve(destination);
  if (target === root || target.startsWith(root + path.sep)) throw new Error('O staging não pode ficar dentro da origem.');
  const filter = entry => {
    const parts = path.relative(root, entry).split(path.sep).filter(Boolean);
    if (parts.some(privateName) || (excludeNodeModules && parts.includes('node_modules'))) return false;
    // Um alias com outro nome não pode contornar a exclusão de um arquivo privado.
    if (privateName(path.basename(fs.realpathSync(entry)))) throw new Error(`Link aponta para arquivo privado: ${entry}`);
    return true;
  };
  // cpSync(dereference) não protege de ciclos: verificar os ancestrais REAIS antes de copiar.
  // Um mesmo pacote em ramos diferentes é permitido; não se usa um visited global que omitiria dependências.
  function inspect(entry, ancestors) {
    if (!filter(entry)) return;
    const real = fs.realpathSync(entry);
    const stat = fs.statSync(entry);
    if (!stat.isDirectory()) {
      if (!stat.isFile()) throw new Error(`Entrada não suportada no standalone: ${entry}`);
      return;
    }
    if (ancestors.has(real)) throw new Error(`Link circular no standalone: ${entry} -> ${real}`);
    const next = new Set(ancestors); next.add(real);
    for (const name of fs.readdirSync(entry)) inspect(path.join(entry, name), next);
  }
  try {
    inspect(root, new Set());
    fs.cpSync(root, target, { recursive: true, dereference: true, force: true, filter });
    assertMaterialized(target);
  } catch (error) {
    throw new Error(`Falha ao materializar ${root} em ${target}: ${error.message}`, { cause: error });
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
