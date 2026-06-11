'use strict';

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const { XMLParser } = require('fast-xml-parser');

const RULE_ID = 'R9';
const RULE_NAME = 'promotion-discount-threshold';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['promotion', 'discount', 'campaign'].includes(name)
});

/**
 * Extract discount percentage values from a promotion XML node
 */
function extractDiscounts(promotion) {
  const discounts = [];

  // Traverse known discount structures in SFCC promotion XML:
  // <discount type="percentage"><percentage>100</percentage></discount>
  // <discount type="bonus-choice-percentage"><percentage>50</percentage></discount>

  function traverse(obj, promotionId) {
    if (!obj || typeof obj !== 'object') return;

    // Direct percentage node
    if (obj.percentage !== undefined) {
      const val = parseFloat(obj.percentage);
      if (!isNaN(val)) {
        discounts.push({ promotionId, percentage: val });
      }
    }

    // discount array or object
    if (obj.discount) {
      const discountNodes = Array.isArray(obj.discount)
        ? obj.discount
        : [obj.discount];

      for (const d of discountNodes) {
        traverse(d, promotionId);
      }
    }

    // price-adjustment-discount, order-discount, etc
    for (const key of Object.keys(obj)) {
      if (key.includes('discount') && typeof obj[key] === 'object') {
        traverse(obj[key], promotionId);
      }
    }
  }

  const promotionId = promotion['@_promotion-id'] || promotion['@_id'] || 'unknown';
  traverse(promotion, promotionId);

  return discounts;
}

/**
 * Scan a single promotion XML file
 */
function scanFile(filePath, threshold) {
  const violations = [];
  let source;

  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return violations;
  }

  // Quick check
  if (!source.includes('percentage') && !source.includes('discount')) {
    return violations;
  }

  let parsed;
  try {
    parsed = parser.parse(source);
  } catch (e) {
    return violations;
  }

  // Navigate SFCC promotion XML structure
  // promotions > promotion[] or promotions > campaigns > campaign > promotions > promotion[]
  const promotions = [];

  function collectPromotions(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (obj.promotion) {
      const promos = Array.isArray(obj.promotion) ? obj.promotion : [obj.promotion];
      promotions.push(...promos);
    }

    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object' && key !== 'promotion') {
        collectPromotions(obj[key]);
      }
    }
  }

  collectPromotions(parsed);

  for (const promo of promotions) {
    const discounts = extractDiscounts(promo);

    for (const { promotionId, percentage } of discounts) {
      if (percentage >= threshold) {
        const severity = percentage >= 100 ? 'error' : 'warning';

        violations.push({
          rule: RULE_ID,
          severity,
          file: filePath,
          line: null,
          message: percentage >= 100
            ? `🚨 Promotion \`${promotionId}\` has **${percentage}% discount** — this will zero out order value`
            : `⚠️ Promotion \`${promotionId}\` has **${percentage}% discount** — above configured threshold of ${threshold}%`,
          detail: `Promotion ID: ${promotionId} | Discount: ${percentage}%`,
          fix: percentage >= 100
            ? 'A 100% discount will make orders free. If intentional, add a sfcc-guard-ignore comment.'
            : `Review if ${percentage}% discount is intentional for this promotion`
        });
      }
    }
  }

  return violations;
}

function run(cartridgesPath, metadataPath, threshold = 99) {
  const results = [];
  const thresholdNum = parseFloat(threshold);

  // Search in both cartridges and metadata paths
  const searchPaths = [cartridgesPath];
  if (metadataPath && fs.existsSync(metadataPath)) {
    searchPaths.push(metadataPath);
  }

  for (const searchPath of searchPaths) {
    const xmlFiles = glob.sync('**/*.xml', {
      cwd: searchPath,
      absolute: true,
      ignore: ['**/node_modules/**']
    });

    // Filter to likely promotion files
    const promotionFiles = xmlFiles.filter(f => {
      const name = path.basename(f).toLowerCase();
      const content = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').substring(0, 500) : '';
      return (
        name.includes('promo') ||
        name.includes('campaign') ||
        content.includes('<promotions') ||
        content.includes('<promotion ') ||
        content.includes('promotion-id')
      );
    });

    for (const file of promotionFiles) {
      const violations = scanFile(file, thresholdNum);
      results.push(...violations);
    }
  }

  return {
    rule: RULE_ID,
    name: RULE_NAME,
    results
  };
}

module.exports = { run, scanFile };
