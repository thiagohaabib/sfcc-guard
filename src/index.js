'use strict';

const core = require('@actions/core');
const path = require('path');
const fs = require('fs');

const R3 = require('./rules/R3-transaction-wrap');
const R4 = require('./rules/R4-hook-implementation');
const R5 = require('./rules/R5-require-pattern');
const R9 = require('./rules/R9-promotion-discount');
const { postComment } = require('./reporters/github-comment');

async function run() {
  try {
    // Resolve paths
    const workspaceRoot = process.env.GITHUB_WORKSPACE || process.cwd();
    const cartridgesPathInput = core.getInput('cartridges-path') || './cartridges';
    const metadataPathInput = core.getInput('metadata-path') || './data_impex';
    const discountThreshold = parseFloat(core.getInput('discount-threshold') || '99');
    const failOnWarning = core.getInput('fail-on-warning') === 'true';

    const cartridgesPath = path.resolve(workspaceRoot, cartridgesPathInput);
    const metadataPath = path.resolve(workspaceRoot, metadataPathInput);

    // Validate cartridges path exists
    if (!fs.existsSync(cartridgesPath)) {
      core.setFailed(`Cartridges path not found: ${cartridgesPath}`);
      return;
    }

    core.info(`\n🛡️  SFCC Guard starting...`);
    core.info(`📁 Cartridges: ${cartridgesPath}`);
    core.info(`📁 Metadata:   ${metadataPath}`);
    core.info(`💰 Discount threshold: ${discountThreshold}%\n`);

    // Run all rules
    const allResults = [];

    core.startGroup('R3 — Transaction.wrap required');
    const r3 = R3.run(cartridgesPath);
    allResults.push(r3);
    core.info(`Found ${r3.results.length} violation(s)`);
    core.endGroup();

    core.startGroup('R4 — Hook implementation check');
    const r4 = R4.run(cartridgesPath);
    allResults.push(r4);
    core.info(`Found ${r4.results.length} violation(s)`);
    core.endGroup();

    core.startGroup('R5 — require() pattern check');
    const r5 = R5.run(cartridgesPath);
    allResults.push(r5);
    core.info(`Found ${r5.results.length} violation(s)`);
    core.endGroup();

    core.startGroup('R9 — Promotion discount threshold');
    const r9 = R9.run(cartridgesPath, metadataPath, discountThreshold);
    allResults.push(r9);
    core.info(`Found ${r9.results.length} violation(s)`);
    core.endGroup();

    // Count totals
    const allViolations = allResults.flatMap(r => r.results);
    const totalErrors = allViolations.filter(v => v.severity === 'error').length;
    const totalWarnings = allViolations.filter(v => v.severity === 'warning').length;

    // Print summary to console
    core.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    core.info('🛡️  SFCC Guard — Summary');
    core.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    for (const ruleResult of allResults) {
      if (ruleResult.results.length === 0) {
        core.info(`  ✅ ${ruleResult.rule} — OK`);
        continue;
      }
      for (const v of ruleResult.results) {
        const emoji = v.severity === 'error' ? '🔴' : '🟡';
        const loc = v.line ? `:${v.line}` : '';
        const fileShort = v.file.replace(workspaceRoot, '').replace(/^\//, '');
        core.info(`  ${emoji} [${v.rule}] ${fileShort}${loc} — ${v.message}`);
        if (v.fix) core.info(`     💡 ${v.fix}`);
      }
    }

    core.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    core.info(`  Errors:   ${totalErrors}`);
    core.info(`  Warnings: ${totalWarnings}`);
    core.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Set outputs
    core.setOutput('errors-found', totalErrors.toString());
    core.setOutput('warnings-found', totalWarnings.toString());

    // Post PR comment
    await postComment(allResults, totalErrors, totalWarnings);

    // Fail the action if there are errors (or warnings with fail-on-warning)
    if (totalErrors > 0) {
      core.setFailed(`SFCC Guard found ${totalErrors} error(s) that must be fixed before merging.`);
    } else if (failOnWarning && totalWarnings > 0) {
      core.setFailed(`SFCC Guard found ${totalWarnings} warning(s) (fail-on-warning is enabled).`);
    } else if (totalWarnings > 0) {
      core.warning(`SFCC Guard found ${totalWarnings} warning(s). Review before merging.`);
    } else {
      core.info('✅ SFCC Guard passed — safe to merge!');
    }

  } catch (error) {
    core.setFailed(`SFCC Guard unexpected error: ${error.message}\n${error.stack}`);
  }
}

run();
