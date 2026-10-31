'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { copyMaterialized, assertMaterialized } = require('../scripts/frontend-files.cjs');
const { completeFrontend } = require('../scripts/complete-frontend.cjs');
function temp(t) { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ponto-copy-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true })); return folder; }
function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
function pkg(folder, name, version = '1.0.0', dependencies = {}) {
  write(path.join(folder, 'package.json'), JSON.stringify({ name, version, main: 'index.js', dependencies }));
  write(path.join(folder, 'index.js'), `module.exports=${JSON.stringify(version)};`);
}

test('copia árvore hoisted independente, preservando dependências e binários, sem .env', t => {
  const root = temp(t), source = path.join(root, 'source'), destination = path.join(root, 'stage');
  const react = path.join(source, 'node_modules/react');
  pkg(react, 'react');
  write(path.join(source, 'server.js'), "module.exports=require('react');");
  write(path.join(source, '.env.local'), 'SEGREDO=nao-copiar');
  write(path.join(source, '.ENV.TEST'), 'SEGREDO=nao-copiar');
  write(path.join(react, '.env.production'), 'SEGREDO=nao-copiar');
  write(path.join(react, 'binding.node'), Buffer.from([0x4d, 0x5a, 1, 2]));
  fs.cpSync(react, path.join(source, 'node_modules/alias-react'), { recursive: true });
  copyMaterialized(source, destination);
  assertMaterialized(destination);
  assert.equal(fs.existsSync(path.join(destination, '.env.local')), false);
  assert.equal(fs.existsSync(path.join(destination, '.ENV.TEST')), false);
  assert.equal(fs.existsSync(path.join(destination, 'node_modules/react/.env.production')), false);
  assert.deepEqual(fs.readFileSync(path.join(destination, 'node_modules/react/binding.node')), Buffer.from([0x4d, 0x5a, 1, 2]));
  // Retirar a origem prova que não restam atalhos para a máquina de build.
  fs.rmSync(source, { recursive: true, force: true });
  assert.equal(require(path.join(destination, 'server.js')), '1.0.0');
  assert.equal(require(path.join(destination, 'node_modules/alias-react')), '1.0.0');
});

test('junction cíclico é rejeitado sem seguir o alvo ou omitir a dependência', t => {
  const root = temp(t), source = path.join(root, 'source'); fs.mkdirSync(source);
  fs.symlinkSync(source, path.join(source, 'ciclo'), 'junction');
  assert.throws(() => copyMaterialized(source, path.join(root, 'stage')), /hoisted/);
  assert.equal(fs.existsSync(path.join(root, 'stage/ciclo/ciclo')), false);
});

test('link quebrado e alias para segredo são erros explícitos', t => {
  const root = temp(t), source = path.join(root, 'source'); fs.mkdirSync(source);
  fs.symlinkSync(path.join(root, 'ausente'), path.join(source, 'dependencia'), 'junction');
  assert.throws(() => copyMaterialized(source, path.join(root, 'stage')), /hoisted/);
  fs.unlinkSync(path.join(source, 'dependencia'));
  fs.mkdirSync(path.join(root, '.secrets'));
  fs.symlinkSync(path.join(root, '.secrets'), path.join(source, 'alias'), 'junction');
  assert.throws(() => copyMaterialized(source, path.join(root, 'stage')), /hoisted/);
});

test('react com junction não é pulado na complementação: exige reinstalação hoisted', t => {
  const root = temp(t), source = path.join(root, 'frontend'), stage = path.join(root, 'stage');
  pkg(path.join(source, 'node_modules/next'), 'next');
  const react = path.join(root, 'react-real'); pkg(react, 'react');
  fs.symlinkSync(react, path.join(source, 'node_modules/react'), 'junction');
  assert.throws(() => completeFrontend(source, stage), /react.*hoisted/);
});

test('complementação preserva versões distintas no contexto correto', t => {
  const root = temp(t), source = path.join(root, 'frontend'), stage = path.join(root, 'stage');
  pkg(path.join(source, 'node_modules/next'), 'next', '1.0.0', { semver: '1.0.0', a: '1.0.0' });
  pkg(path.join(source, 'node_modules/next/node_modules/semver'), 'semver', '1.0.0');
  pkg(path.join(source, 'node_modules/a'), 'a', '1.0.0', { b: '1.0.0' });
  pkg(path.join(source, 'node_modules/b'), 'b', '1.0.0', { a: '1.0.0' });
  write(path.join(source, 'node_modules/a/index.js'), "module.exports=require('b');");
  write(path.join(source, 'node_modules/b/index.js'), "module.exports=require.resolve('a');");
  pkg(path.join(source, 'node_modules/react'), 'react');
  pkg(path.join(source, 'node_modules/react-dom'), 'react-dom');
  pkg(path.join(source, 'node_modules/sharp'), 'sharp', '1.0.0', { semver: '2.0.0' });
  pkg(path.join(source, 'node_modules/sharp/node_modules/semver'), 'semver', '2.0.0');
  const variant = process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime ? 'linuxmusl' : process.platform;
  const native = `@img/sharp-${variant}-${process.arch}`;
  pkg(path.join(source, 'node_modules/sharp/node_modules', native), native);
  write(path.join(source, 'node_modules/sharp/node_modules', native, 'package.json'), JSON.stringify({name:native,version:'1.0.0',exports:{'./binding.node':'./binding.node'}}));
  fs.mkdirSync(stage); write(path.join(stage, 'package.json'), '{}');
  completeFrontend(source, stage);
  const next = createRequire(path.join(stage, 'node_modules/next/package.json'));
  const sharp = createRequire(path.join(stage, 'node_modules/sharp/package.json'));
  assert.equal(next('semver'), '1.0.0'); assert.equal(sharp('semver'), '2.0.0');
  assert.ok(next('a').startsWith(stage + path.sep), 'ciclo declarado A/B deve reutilizar o pacote correspondente no staging');
  assertMaterialized(stage);
});

test('validação rejeita dependência encontrada fora do staging via NODE_PATH', t => {
  const root = temp(t), stage = path.join(root, 'stage'), external = path.join(root, 'externo');
  write(path.join(stage, 'server.js'), ''); write(path.join(stage, 'package.json'), '{}');
  pkg(path.join(external, 'next'), 'next');
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/validate-frontend.cjs'), stage], {
    cwd: stage, env: { ...process.env, NODE_PATH: external }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /fora do pacote/);
});
