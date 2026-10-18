import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCpf } from '../lib/cpf.ts';

test('CPF formata digitação, colagem e edição com no máximo 11 dígitos', () => {
  for (const [input, expected] of [
    ['', ''], ['123', '123'], ['1234', '123.4'],
    ['1234567', '123.456.7'], ['1234567890', '123.456.789-0'],
    ['00123456789', '001.234.567-89'],
    ['001.234.567-89', '001.234.567-89'],
    ['001234567890123', '001.234.567-89'],
    ['abc001.234.567-89xyz', '001.234.567-89'],
    ['001.234.567-', '001.234.567'],
  ]) assert.equal(formatCpf(input), expected);
});
