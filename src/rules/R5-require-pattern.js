'use strict';

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { glob } = require('glob');

const RULE_ID = 'R5';
const RULE_NAME = 'require-pattern-invalid';

// Valid SFCC require prefixes
const VALID_PREFIXES = [
  'dw/',          // DW API: require('dw/system/Site')
  '*/',           // Cartridge path: require('*/cartridge/scripts/...')
  '~/',           // Current cartridge: require('~/cartridge/scripts/...')
  'server',       // SFRA server module
  'base/',        // Used in some SFRA patterns
];

// Paths that are always OK (node built-ins, etc)
const ALWAYS_VALID = [
  'path', 'fs', 'url', 'crypto', 'util', 'os',
  'querystring', 'events', 'stream', 'buffer'
];

/**
 * Check if a require path is valid SFCC pattern
 */
function isValidRequire(requirePath) {
  if (!requirePath || typeof requirePath !== 'string') return true;

  // Node built-ins are fine
  if (ALWAYS_VALID.includes(requirePath)) return true;

  // Absolute paths from node_modules are fine (cartridge deps)
  if (!requirePath.startsWith('.') && !requirePath.startsWith('/')) {
    // Could be a node module — check if it looks like SFCC path
    // If it doesn't have a / it's a plain module name, OK
    if (!requirePath.includes('/')) return true;
    // If it starts with a valid prefix, OK
    if (VALID_PREFIXES.some(p => requirePath.startsWith(p))) return true;
    // Otherwise it could be a node_module with subpath — OK
    return true;
  }

  // Relative paths like ../../ are INVALID in SFCC server-side scripts
  if (requirePath.startsWith('../') || requirePath.startsWith('./')) {
    return false;
  }

  // Absolute /path is invalid
  if (requirePath.startsWith('/')) return false;

  return true;
}

function scanFile(filePath) {
  const violations = [];
  let source;

  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return violations;
  }

  // Quick check
  if (!source.includes('require(')) return violations;

  let ast;
  try {
    ast = acorn.parse(source, {
      ecmaVersion: 2020,
      sourceType: 'script',
      locations: true
    });
  } catch (e) {
    return violations;
  }

  const lines = source.split('\n');

  walk.simple(ast, {
    CallExpression(node) {
      // require('...')
      if (
        node.callee.type !== 'Identifier' ||
        node.callee.name !== 'require'
      ) return;

      if (
        !node.arguments.length ||
        node.arguments[0].type !== 'Literal'
      ) return;

      const requirePath = node.arguments[0].value;
      if (isValidRequire(requirePath)) return;

      const lineNum = node.loc.start.line;
      const lineCode = lines[lineNum - 1].trim();

      violations.push({
        rule: RULE_ID,
        severity: 'error',
        file: filePath,
        line: lineNum,
        message: `Invalid \`require()\` path: \`${requirePath}\``,
        detail: lineCode,
        fix: `Use SFCC cartridge path instead: require('*/cartridge/scripts/...') or require('~/cartridge/scripts/...')`
      });
    }
  });

  return violations;
}

function run(cartridgesPath) {
  const results = [];

  const jsFiles = glob.sync('**/scripts/**/*.js', {
    cwd: cartridgesPath,
    absolute: true,
    ignore: ['**/node_modules/**', '**/client/**', '**/__tests__/**', '**/test/**']
  });

  for (const file of jsFiles) {
    const violations = scanFile(file);
    results.push(...violations);
  }

  return {
    rule: RULE_ID,
    name: RULE_NAME,
    results
  };
}

module.exports = { run, scanFile };
