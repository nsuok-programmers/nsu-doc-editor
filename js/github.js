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

import { parseDat, serializeDat } from './parser.js';

const GITHUB_API   = 'https://api.github.com';
const GH_TOKEN     = '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';
const GH_READ_TOKEN = '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';
const GH_OWNER     = 'nathantbeene';
const GH_REPO      = 'nsu-doc-editor';   // submission target (this app's repo)
const GH_PROD_REPO = 'nsu-prod-docs';    // source of truth for browsing/reading
const GH_BASE      = 'main';

/**
 * Full pipeline: create branch → upload file → open PR.
 *
 * @param {Object} opts
 * @param {string}   opts.tableName      - e.g. SGBSTDN
 * @param {string}   opts.tableType      - 'data' or 'definition'
 * @param {string}   opts.jsonContent    - Stringified JSON to commit
 * @param {Array}    opts.queries        - Raw query objects with { file, sql }
 * @param {string}   opts.submitterName  - Person submitting
 * @param {string}   opts.submitterTeam  - Their team
 * @param {string}   opts.description    - Notes for the PR
 * @returns {Promise<{prUrl: string, branchName: string}>}
 */
export async function submitTableDefinition({ tableName, tableType = 'data', jsonContent, queries, definitionData, submitterName, submitterTeam, description }) {
  // 1. Determine add vs update by checking nsu-prod-docs
  const filePath = `table-definitions/${tableType}/${tableName}/${tableName}.json`;
  const prodCheck = await ghReadFetch(`/repos/${GH_OWNER}/${GH_PROD_REPO}/contents/${filePath}`);
  const verb = prodCheck.ok ? 'update' : 'add';
  const branchName = `submissions/${verb}/${tableName.toLowerCase()}`;

  // 2. Collect all files to include in the submission
  const enc = new TextEncoder();
  const b64 = str => btoa(String.fromCharCode(...enc.encode(str)));

  const fileEntries = [
    { path: filePath, content: jsonContent },
    ...queries.filter(q => q.file && q.sql).map(q => ({
      path: `table-definitions/${tableType}/${tableName}/sql/${q.file}`,
      content: q.sql
    })),
    ...(tableType === 'definition' && definitionData?.length
      ? [{ path: `table-definitions/${tableType}/${tableName}/${tableName}.dat`, content: serializeDat(definitionData) }]
      : [])
  ];

  // 3. Get main's current HEAD so the branch shares history (required for PR creation)
  const mainRefRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/git/ref/heads/${GH_BASE}`);
  if (!mainRefRes.ok) { const e = await mainRefRes.json(); throw new Error(`Failed to get main ref: ${e.message}`); }
  const mainSha = (await mainRefRes.json()).object.sha;

  const mainCommitRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/git/commits/${mainSha}`);
  if (!mainCommitRes.ok) { const e = await mainCommitRes.json(); throw new Error(`Failed to get main commit: ${e.message}`); }
  const mainTreeSha = (await mainCommitRes.json()).tree.sha;

  // 4. Create blobs for each file
  const treeItems = await Promise.all(fileEntries.map(async ({ path, content }) => {
    const res = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/git/blobs`, 'POST', {
      content:  b64(content),
      encoding: 'base64'
    });
    if (!res.ok) { const e = await res.json(); throw new Error(`Blob failed for ${path}: ${e.message}`); }
    const { sha } = await res.json();
    return { path, mode: '100644', type: 'blob', sha };
  }));

  // 5. Create a tree on top of main's tree — PR diff will only show the submission files
  const treeRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/git/trees`, 'POST', { base_tree: mainTreeSha, tree: treeItems });
  if (!treeRes.ok) { const e = await treeRes.json(); throw new Error(`Tree failed: ${e.message}`); }
  const treeSha = (await treeRes.json()).sha;

  // 6. Create a commit with main as parent so GitHub can compute the PR diff
  const commitRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/git/commits`, 'POST', {
    message: `submission: ${verb} ${tableName} table definition`,
    tree:    treeSha,
    parents: [mainSha]
  });
  if (!commitRes.ok) { const e = await commitRes.json(); throw new Error(`Commit failed: ${e.message}`); }
  const commitSha = (await commitRes.json()).sha;

  // 7. Create (or update) the branch pointing to the new commit
  const branchRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/git/refs`, 'POST', {
    ref: `refs/heads/${branchName}`,
    sha: commitSha
  });
  if (!branchRes.ok) {
    if (branchRes.status === 422) {
      // Branch already exists — only block if there's an open PR on it
      const openPrRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/pulls?head=${GH_OWNER}:${branchName}&state=open`);
      if (openPrRes.ok && (await openPrRes.json()).length > 0) {
        throw new Error(`A submission for ${tableName} is already pending review.`);
      }
      // No open PR (leftover branch from a failed attempt) — force-update it
      const updateRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/git/refs/heads/${branchName}`, 'PATCH', {
        sha: commitSha, force: true
      });
      if (!updateRes.ok) { const e = await updateRes.json(); throw new Error(`Failed to update branch: ${e.message}`); }
    } else {
      const err = await branchRes.json();
      throw new Error(`Failed to create branch: ${err.message}`);
    }
  }

  // 8. Open Pull Request on nsu-doc-editor
  const prBodyLines = [
    `**Submitted by:** ${submitterName} (${submitterTeam})`,
    description ? `\n**Notes:** ${description}` : '',
    `\n${verb === 'update' ? 'Updates' : 'Adds'} the table definition for \`${tableName}\`.`,
    `\n_Automated submission via the DB Docs Editor. Approving this PR will forward it to nsu-prod-docs._`
  ].filter(Boolean).join('\n');

  const prRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/pulls`, 'POST', {
    title: `submission: ${verb} ${tableName} table definition`,
    body:  prBodyLines,
    head:  branchName,
    base:  GH_BASE
  });
  if (!prRes.ok) {
    const err = await prRes.json();
    throw new Error(`Failed to open PR: ${err.message}`);
  }

  return { prUrl: (await prRes.json()).html_url, branchName };
}

// ── Read helpers ─────────────────────────────────────────────────────────────

/**
 * Returns a sorted array of { name, type } objects from table-definitions/data/
 * and table-definitions/definition/ on main.
 * @returns {Promise<Array<{name: string, type: string}>>}
 */
export async function listRepoTables() {
  const [dataRes, defRes] = await Promise.all([
    ghReadFetch(`/repos/${GH_OWNER}/${GH_PROD_REPO}/contents/table-definitions/data`),
    ghReadFetch(`/repos/${GH_OWNER}/${GH_PROD_REPO}/contents/table-definitions/definition`)
  ]);

  const dataEntries = dataRes.ok ? (await dataRes.json()).filter(e => e.type === 'dir').map(e => ({ name: e.name, type: 'data' })) : [];
  const defEntries  = defRes.ok  ? (await defRes.json()).filter(e => e.type === 'dir').map(e => ({ name: e.name, type: 'definition' })) : [];

  return [...dataEntries, ...defEntries].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fetches the JSON + all SQL files for one table and returns a complete
 * in-memory table object (matching the shape editor.js uses).
 * @param {string} tableName
 * @param {string} tableType - 'data' or 'definition'
 * @returns {Promise<Object>}
 */
export async function fetchTableFromRepo(tableName, tableType = 'data') {
  const jsonRes = await ghReadFetch(`/repos/${GH_OWNER}/${GH_PROD_REPO}/contents/table-definitions/${tableType}/${tableName}/${tableName}.json`);
  if (!jsonRes.ok) throw new Error(`Table ${tableName}: JSON file not found.`);
  const { content } = await jsonRes.json();
  const table = JSON.parse(atob(content.replace(/\n/g, '')));

  // Ensure required fields exist regardless of when the file was created
  if (!table.queries)  table.queries  = [];
  if (!table.columns)  table.columns  = [];
  if (!table.tags)     table.tags     = [];
  if (tableType === 'definition' && !table['definition_headers']) table['definition_headers'] = [];

  // Fetch all SQL files concurrently; missing files degrade silently
  await Promise.allSettled(table.queries.map(async (query) => {
    const sqlRes = await ghReadFetch(`/repos/${GH_OWNER}/${GH_PROD_REPO}/contents/table-definitions/${tableType}/${tableName}/sql/${query.file}`);
    if (sqlRes.ok) {
      const { content: sqlContent } = await sqlRes.json();
      query.sql = atob(sqlContent.replace(/\n/g, ''));
    } else {
      query.sql = '';
    }
  }));

  // Fetch .dat file for definition tables
  if (tableType === 'definition') {
    const datRes = await ghReadFetch(`/repos/${GH_OWNER}/${GH_PROD_REPO}/contents/table-definitions/${tableType}/${tableName}/${tableName}.dat`);
    if (datRes.ok) {
      const { content: datContent } = await datRes.json();
      const raw = atob(datContent.replace(/\n/g, ''));
      table['definition_data'] = parseDat(raw);
    } else {
      table['definition_data'] = [];
    }
  }

  return table;
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

// Read-only requests against nsu-prod-docs use a separate token
async function ghReadFetch(path) {
  return fetch(`${GITHUB_API}${path}`, {
    headers: {
      'Authorization': `Bearer ${GH_READ_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
}
