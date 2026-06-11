'use strict';

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

const RULE_ID = 'R4';
const RULE_NAME = 'hook-implementation-missing';

/**
 * Resolve hook script path relative to cartridge root
 * hooks.json script: "./cartridge/scripts/hooks/cart/calculate.js"
 * cartridge root: /path/to/cartridges/org_climate
 */
function resolveHookPath(cartridgeRoot, scriptPath) {
  // Remove leading './'
  const normalized = scriptPath.replace(/^\.\//, '');
  const candidates = [
    path.join(cartridgeRoot, normalized),
    path.join(cartridgeRoot, normalized + '.js'),
    path.join(cartridgeRoot, normalized + '.ds')  // legacy SFCC scripts
  ];
  return candidates;
}

/**
 * Check all hooks.json files in cartridges
 */
function run(cartridgesPath) {
  const results = [];

  // Find all package.json files that declare hooks
  const packageFiles = glob.sync('*/package.json', {
    cwd: cartridgesPath,
    absolute: true
  });

  for (const pkgFile of packageFiles) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    } catch (e) {
      continue;
    }

    if (!pkg.hooks) continue;

    const cartridgeRoot = path.dirname(pkgFile);
    const cartridgeName = path.basename(cartridgeRoot);

    // Resolve hooks.json path
    const hooksJsonPath = path.resolve(cartridgeRoot, pkg.hooks);

    if (!fs.existsSync(hooksJsonPath)) {
      results.push({
        rule: RULE_ID,
        severity: 'error',
        file: pkgFile,
        line: null,
        message: `\`hooks\` declared in package.json but \`${pkg.hooks}\` file not found`,
        detail: `Cartridge: ${cartridgeName}`,
        fix: `Create the hooks file at: ${hooksJsonPath}`
      });
      continue;
    }

    let hooksConfig;
    try {
      hooksConfig = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
    } catch (e) {
      results.push({
        rule: RULE_ID,
        severity: 'error',
        file: hooksJsonPath,
        line: null,
        message: `Invalid JSON in hooks file`,
        detail: e.message,
        fix: 'Fix the JSON syntax in the hooks file'
      });
      continue;
    }

    if (!Array.isArray(hooksConfig.hooks)) continue;

    for (const hook of hooksConfig.hooks) {
      if (!hook.name || !hook.script) continue;

      const candidates = resolveHookPath(cartridgeRoot, hook.script);
      const exists = candidates.some(c => fs.existsSync(c));

      if (!exists) {
        results.push({
          rule: RULE_ID,
          severity: 'error',
          file: hooksJsonPath,
          line: null,
          message: `Hook \`${hook.name}\` declared but implementation not found`,
          detail: `Expected at: ${hook.script}`,
          fix: `Create the hook implementation file or remove the hook declaration from hooks.json`
        });
      }
    }
  }

  return {
    rule: RULE_ID,
    name: RULE_NAME,
    results
  };
}

module.exports = { run };
