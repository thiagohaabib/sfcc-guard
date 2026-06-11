'use strict';

const core = require('@actions/core');
const github = require('@actions/github');

const SEVERITY_EMOJI = {
  error: '🔴',
  warning: '🟡'
};

const RULE_DOCS = {
  R3: 'Transaction.wrap required for order writes',
  R4: 'Hook implementation missing',
  R5: 'Invalid require() path pattern',
  R9: 'Promotion discount threshold exceeded'
};

/**
 * Format a single violation into markdown
 */
function formatViolation(v) {
  const emoji = SEVERITY_EMOJI[v.severity] || '⚪';
  const location = v.line ? ` (line ${v.line})` : '';
  const fileShort = v.file.replace(process.cwd(), '').replace(/^\//, '');

  let md = `${emoji} **[${v.rule}]** ${v.message}\n`;
  md += `> 📁 \`${fileShort}\`${location}\n`;
  if (v.detail) md += `> \`${v.detail}\`\n`;
  if (v.fix) md += `> 💡 ${v.fix}\n`;

  return md;
}

/**
 * Build the full PR comment body
 */
function buildComment(allResults, totalErrors, totalWarnings) {
  const status = totalErrors > 0 ? '🔴 FAILED' : totalWarnings > 0 ? '🟡 PASSED WITH WARNINGS' : '🟢 PASSED';
  const summary = totalErrors > 0
    ? `**${totalErrors} error(s)** must be fixed before merging.`
    : totalWarnings > 0
    ? `**${totalWarnings} warning(s)** found. Review before merging.`
    : 'No issues found. Safe to merge.';

  let body = `## SFCC Guard ${status}\n\n${summary}\n\n`;

  if (totalErrors === 0 && totalWarnings === 0) {
    body += `> All ${Object.keys(RULE_DOCS).length} rules passed ✅\n`;
    return body;
  }

  // Group by rule
  for (const ruleResult of allResults) {
    if (!ruleResult.results || ruleResult.results.length === 0) continue;

    const errors = ruleResult.results.filter(r => r.severity === 'error');
    const warnings = ruleResult.results.filter(r => r.severity === 'warning');

    body += `### ${RULE_DOCS[ruleResult.rule] || ruleResult.rule}\n\n`;

    for (const v of [...errors, ...warnings]) {
      body += formatViolation(v) + '\n';
    }
  }

  body += `\n---\n`;
  body += `<details><summary>📖 About SFCC Guard</summary>\n\n`;
  body += `SFCC Guard checks for production-breaking patterns specific to Salesforce Commerce Cloud.\n`;
  body += `Add \`// sfcc-guard-ignore\` comment to suppress a specific violation.\n`;
  body += `</details>\n`;

  return body;
}

/**
 * Post or update a comment on the PR
 */
async function postComment(allResults, totalErrors, totalWarnings) {
  const token = core.getInput('github-token');
  if (!token) {
    core.info('No GitHub token provided — skipping PR comment');
    return;
  }

  const context = github.context;
  if (!context.payload.pull_request) {
    core.info('Not a PR — skipping comment');
    return;
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request.number;

  const body = buildComment(allResults, totalErrors, totalWarnings);
  const MARKER = '<!-- sfcc-guard-comment -->';
  const commentBody = `${MARKER}\n${body}`;

  // Check if we already have a comment from previous run
  const comments = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber
  });

  const existing = comments.data.find(c => c.body.includes(MARKER));

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body: commentBody
    });
    core.info(`Updated existing SFCC Guard comment #${existing.id}`);
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: commentBody
    });
    core.info('Created new SFCC Guard comment');
  }
}

module.exports = { postComment, buildComment };
