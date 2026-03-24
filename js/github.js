/**
 * github.js
 * Handles all GitHub API interactions for submitting table definitions.
 *
 * Flow:
 *   1. Get the SHA of the base branch (main)
 *   2. Create a new branch  e.g. docs/add-SGBSTDN
 *   3. Create or update the JSON file on that branch
 *   4. Create or update each query's .sql file under table-definitions/TABLE/sql/
 *   5. Open a Pull Request back to main
 */

const GITHUB_API  = 'https://api.github.com';
const GH_TOKEN    = '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';
const GH_OWNER    = 'nathantbeene';
const GH_REPO     = 'nsu-prod-docs';
const GH_BASE     = 'main';

/**
 * Full pipeline: create branch → upload file → open PR.
 *
 * @param {Object} opts
 * @param {string}   opts.tableName      - e.g. SGBSTDN
 * @param {string}   opts.jsonContent    - Stringified JSON to commit
 * @param {Array}    opts.queries        - Raw query objects with { file, sql }
 * @param {string}   opts.submitterName  - Person submitting
 * @param {string}   opts.submitterTeam  - Their team
 * @param {string}   opts.description    - Notes for the PR
 * @returns {Promise<{prUrl: string, branchName: string}>}
 */
export async function submitTableDefinition({ tableName, jsonContent, queries, submitterName, submitterTeam, description }) {
  // 1. Get base branch SHA
  const refRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/git/ref/heads/${GH_BASE}`);
  if (!refRes.ok) throw new Error(`Could not find branch '${GH_BASE}' in ${GH_OWNER}/${GH_REPO}.`);
  const baseSha = (await refRes.json()).object.sha;

  // 2. Create new branch
  const branchName = `docs/add-${tableName.toLowerCase()}-${Date.now()}`;
  const branchRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/git/refs`, 'POST', {
    ref: `refs/heads/${branchName}`,
    sha: baseSha
  });
  if (!branchRes.ok) throw new Error(`Failed to create branch '${branchName}'.`);

  // 3. Check if file already exists (to get its SHA for update)
  const filePath = `table-definitions/${tableName}/${tableName}.json`;
  let existingSha = null;
  const existsRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/contents/${filePath}?ref=${branchName}`);
  if (existsRes.ok) existingSha = (await existsRes.json()).sha;

  // 4. Create or update file
  const fileBody = {
    message: `docs: add/update ${tableName} table definition`,
    content: btoa(String.fromCharCode(...new TextEncoder().encode(jsonContent))),
    branch: branchName
  };
  if (existingSha) fileBody.sha = existingSha;

  const fileRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/contents/${filePath}`, 'PUT', fileBody);
  if (!fileRes.ok) {
    const err = await fileRes.json();
    throw new Error(`Failed to write file: ${err.message}`);
  }

  // 5. Commit each query's SQL file
  for (const query of queries) {
    if (!query.file || !query.sql) continue;
    const sqlPath = `table-definitions/${tableName}/sql/${query.file}`;
    let sqlSha = null;
    const sqlExistsRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/contents/${sqlPath}?ref=${branchName}`);
    if (sqlExistsRes.ok) sqlSha = (await sqlExistsRes.json()).sha;

    const sqlBody = {
      message: `docs: add/update ${query.file} for ${tableName}`,
      content: btoa(String.fromCharCode(...new TextEncoder().encode(query.sql))),
      branch: branchName
    };
    if (sqlSha) sqlBody.sha = sqlSha;

    const sqlRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/contents/${sqlPath}`, 'PUT', sqlBody);
    if (!sqlRes.ok) {
      const err = await sqlRes.json();
      throw new Error(`Failed to write ${query.file}: ${err.message}`);
    }
  }

  // 6. Open Pull Request
  const prBody = [
    `**Submitted by:** ${submitterName} (${submitterTeam})`,
    '',
    description ? `**Notes:** ${description}` : '',
    '',
    `Adds or updates the table definition for \`${tableName}\`.`,
    '',
    '_Automated PR created via the DB Docs Editor._'
  ].filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n');

  const prRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/pulls`, 'POST', {
    title: `docs: ${tableName} table definition`,
    body:  prBody,
    head:  branchName,
    base:  GH_BASE
  });
  if (!prRes.ok) {
    const err = await prRes.json();
    throw new Error(`Failed to open PR: ${err.message}`);
  }

  return { prUrl: (await prRes.json()).html_url, branchName };
}

// ── Internal helper ──────────────────────────────────────────────────────────

async function ghFetch(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${GITHUB_API}${path}`, opts);
}
