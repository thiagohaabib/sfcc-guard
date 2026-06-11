'use strict';

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const RULE_ID = 'R3';
const RULE_NAME = 'transaction-wrap-required';

// DW API objects that require Transaction.wrap for writes
const TRANSACTIONAL_OBJECTS = [
  'order', 'basket', 'lineItem', 'shipment', 'paymentInstrument',
  'productLineItem', 'shippingLineItem', 'priceAdjustment',
  'giftCertificateLineItem', 'orderAddress', 'paymentTransaction'
];

// Write methods that MUST be inside Transaction.wrap
const WRITE_PATTERNS = [
  // Direct assignment to .custom.*
  /\.custom\.\w+\s*=/,
  // setXxx() calls on transactional objects
  /\.(setStatus|setExternalOrderNo|setExportStatus|setConfirmationStatus|addProductLineItem|removeProductLineItem|setShippingMethod|createShipment|setPaymentStatus)\s*\(/
];

/**
 * Check if a node is inside a Transaction.wrap() call
 */
function isInsideTransactionWrap(ancestors) {
  return ancestors.some(ancestor => {
    if (ancestor.type !== 'CallExpression') return false;
    const callee = ancestor.callee;
    // Transaction.wrap(...)
    if (
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      callee.object.name === 'Transaction' &&
      callee.property.name === 'wrap'
    ) return true;
    return false;
  });
}

/**
 * Check if a node touches a transactional object
 */
function involvesTransactionalObject(node) {
  const code = nodeToString(node);
  return TRANSACTIONAL_OBJECTS.some(obj =>
    code.toLowerCase().includes(obj.toLowerCase())
  );
}

function nodeToString(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') {
    return nodeToString(node.object) + '.' + nodeToString(node.property);
  }
  return '';
}

/**
 * Scan a single JS file for Transaction.wrap violations
 */
function scanFile(filePath) {
  const violations = [];
  let source;

  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return violations;
  }

  // Quick pre-check: skip files that don't touch transactional objects
  const hasDWOrder = source.includes('dw/order') || 
                     source.includes('OrderMgr') ||
                     source.includes('BasketMgr') ||
                     source.includes('Transaction');
  if (!hasDWOrder) return violations;

  let ast;
  try {
    ast = acorn.parse(source, {
      ecmaVersion: 2020,
      sourceType: 'script',
      locations: true
    });
  } catch (e) {
    // Parse error — not our problem to report here
    return violations;
  }

  const lines = source.split('\n');

  // Walk the AST looking for assignments to .custom.* outside Transaction.wrap
  walk.ancestor(ast, {
    AssignmentExpression(node, ancestors) {
      if (isInsideTransactionWrap(ancestors)) return;

      const leftCode = nodeToString(node.left);

      // Check for .custom.someAttr = value (writes to custom attrs on DW objects)
      if (leftCode.includes('.custom.')) {
        const lineNum = node.loc.start.line;
        const lineCode = lines[lineNum - 1].trim();

        violations.push({
          rule: RULE_ID,
          severity: 'error',
          file: filePath,
          line: lineNum,
          message: `Write to \`.custom\` attribute outside \`Transaction.wrap()\``,
          detail: lineCode,
          fix: 'Wrap this assignment inside Transaction.wrap(function() { ... })'
        });
      }
    },

    CallExpression(node, ancestors) {
      if (isInsideTransactionWrap(ancestors)) return;
      if (node.callee.type !== 'MemberExpression') return;

      const methodName = node.callee.property.name || '';
      const writeMethodsOutsideTransaction = [
        'setStatus', 'setExportStatus', 'setConfirmationStatus',
        'setExternalOrderNo', 'setPaymentStatus', 'addProductLineItem',
        'removeProductLineItem', 'createShipment', 'setShippingMethod'
      ];

      if (!writeMethodsOutsideTransaction.includes(methodName)) return;

      // Only flag if object looks like a DW order object
      const objectCode = nodeToString(node.callee.object).toLowerCase();
      const isDWObject = TRANSACTIONAL_OBJECTS.some(obj =>
        objectCode.includes(obj.toLowerCase())
      );
      if (!isDWObject) return;

      const lineNum = node.loc.start.line;
      const lineCode = lines[lineNum - 1].trim();

      violations.push({
        rule: RULE_ID,
        severity: 'error',
        file: filePath,
        line: lineNum,
        message: `\`.${methodName}()\` called on order object outside \`Transaction.wrap()\``,
        detail: lineCode,
        fix: 'Wrap this call inside Transaction.wrap(function() { ... })'
      });
    }
  });

  return violations;
}

/**
 * Main rule runner
 */
function run(cartridgesPath) {
  const { glob } = require('glob');
  const results = [];

  // Find all server-side JS files (not client-side)
  const jsFiles = glob.sync('**/scripts/**/*.js', {
    cwd: cartridgesPath,
    absolute: true,
    ignore: ['**/node_modules/**', '**/client/**', '**/__tests__/**']
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
