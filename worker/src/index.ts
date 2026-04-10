import { createAppAuth } from "@octokit/auth-app";

export interface Env {
  GITHUB_APP_ID: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_PRIVATE_KEY: string;
  GH_OWNER: string;
  DOCS_REPO: string;
  ALLOWED_ORIGIN: string;
}

/* ---------------------------------- AUTH ---------------------------------- */

async function getInstallationToken(env: Env): Promise<string> {
  const auth = createAppAuth({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_PRIVATE_KEY,
    installationId: env.GITHUB_INSTALLATION_ID,
  });
  const { token } = await auth({ type: "installation" });
  return token;
}

async function ghFetch(
  token: string,
  path: string,
  method = 'GET',
  body: object | null = null
): Promise<Response> {
  const opts: RequestInit = {
    method,
    headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'nsu-doc-editor-worker',
  },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`https://api.github.com${path}`, opts);
}

function getAllowedOrigin(request: Request, env: Env): string {
  const origin = request.headers.get("Origin") ?? "";
  if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) {
    return origin;
  }
  return env.ALLOWED_ORIGIN;
}

/* -------------------------------- RESPONSES ------------------------------- */

function json(data: unknown, status=200, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
    }
  });
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/* ------------------------------ ROUTE HEADERS ----------------------------- */

async function handleListTables(env: Env, token: string): Promise<{ name: string; type: string }[]> {
  const [dataRes, defRes] = await Promise.all([
    ghFetch(token, `/repos/${env.GH_OWNER}/${env.DOCS_REPO}/contents/table-definitions/data`),
    ghFetch(token, `/repos/${env.GH_OWNER}/${env.DOCS_REPO}/contents/table-definitions/definition`),
  ]);

  if (!dataRes.ok) throw new Error(`data fetch failed: ${dataRes.status} ${await dataRes.text()}`);
  if (!defRes.ok) throw new Error(`definition fetch failed: ${defRes.status} ${await defRes.text()}`);

  const dataEntries = (await dataRes.json()).filter((e: { type: string }) => e.type === 'dir').map((e: { name: string }) => ({ name: e.name, type: 'data' }));
  const defEntries = (await defRes.json()).filter((e: { type: string }) => e.type === 'dir').map((e: { name: string }) => ({ name: e.name, type: 'definition' }));

  return [...dataEntries, ...defEntries].sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
}

async function handleFetchTable(
  env: Env,
  token: string,
  tableType: "data" | "definition",
  tableName: string
): Promise<object> {
  const base = `/repos/${env.GH_OWNER}/${env.DOCS_REPO}/contents/table-definitions/${tableType}/${tableName}`;

  const jsonRes = await ghFetch(token, `${base}/${tableName}.json`);
  if (!jsonRes.ok) throw new Error(`Table ${tableName}: JSON file not found.`);
  const { content } = await jsonRes.json() as { content: string };
  const table = JSON.parse(atob(content.replace(/\n/g, '')));

  if (!table.queries) table.queries = [];
  if (!table.columns) table.columns = [];
  if (!table.tags) table.tags = [];
  if (tableType === 'definition' && !table['definition_headers']) table['definition_headers'] = [];

  // Fetch SQL files
  await Promise.allSettled(
    table.queries.map(async (query: any) => {
      const sqlRes = await ghFetch(token, `${base}/sql/${query.file}`);
      if (sqlRes.ok) {
        const { content: sqlContent } = await sqlRes.json() as { content: string };
        query.sql = atob(sqlContent.replace(/\n/g, ""));
      } else {
        query.sql = "";
      }
    })
  );

  // Fetch .dat file for definition tables
  if (tableType === "definition") {
    const datRes = await ghFetch(token, `${base}/${tableName}.dat`);
    if (datRes.ok) {
      const { content: datContent } = await datRes.json() as { content: string };
      table.definition_data = atob(datContent.replace(/\n/g, ""));
    } else {
      table.definition_data = [];
    }
  }

  return table;
}

async function handleSubmit(env: Env, token: string, body: any): Promise<{ url: string }> {
  const {
    tableName, tableType, jsonContent, queries,
    definitionData, submitterName, submitterTeam, description,
  } = body;

  const owner = env.GH_OWNER;
  const repo  = env.DOCS_REPO;
  const enc   = new TextEncoder();
  const b64   = (str: string) => btoa(String.fromCharCode(...enc.encode(str)));

  // Determine add vs update
  const prodCheck = await ghFetch(
    token,
    `/repos/${owner}/${repo}/contents/table-definitions/${tableType}/${tableName}/${tableName}.json`
  );
  const verb = prodCheck.ok ? "update" : "add";

  // Build file list
  const base = `table-definitions/${tableType}/${tableName}`;
  const files: { path: string; content: string }[] = [
    { path: `${base}/${tableName}.json`, content: jsonContent },
    ...(queries ?? [])
      .filter((q: any) => q.file && q.sql)
      .map((q: any) => ({ path: `${base}/sql/${q.file}`, content: q.sql })),
    ...(tableType === "definition" && definitionData?.length
      ? [{ path: `${base}/${tableName}.dat`, content: definitionData }]
      : []),
  ];

  // Get main branch HEAD
  const refRes = await ghFetch(token, `/repos/${owner}/${repo}/git/ref/heads/main`);
  if (!refRes.ok) { const e: any = await refRes.json(); throw new Error(`Failed to get main ref: ${e.message}`); }
  const mainSha = (await refRes.json() as any).object.sha;

  const commitRes = await ghFetch(token, `/repos/${owner}/${repo}/git/commits/${mainSha}`);
  if (!commitRes.ok) { const e: any = await commitRes.json(); throw new Error(`Failed to get main commit: ${e.message}`); }
  const mainTreeSha = (await commitRes.json() as any).tree.sha;

  // Create blobs
  const treeItems = await Promise.all(
    files.map(async ({ path, content }) => {
      const res = await ghFetch(token, `/repos/${owner}/${repo}/git/blobs`, "POST", {
        content: b64(content),
        encoding: "base64",
      });
      if (!res.ok) { const e: any = await res.json(); throw new Error(`Blob failed for ${path}: ${e.message}`); }
      const { sha } = await res.json() as { sha: string };
      return { path, mode: "100644", type: "blob", sha };
    })
  );

  // Create tree
  const treeRes = await ghFetch(token, `/repos/${owner}/${repo}/git/trees`, "POST", {
    base_tree: mainTreeSha,
    tree: treeItems,
  });
  if (!treeRes.ok) { const e: any = await treeRes.json(); throw new Error(`Tree failed: ${e.message}`); }
  const treeSha = (await treeRes.json() as any).sha;

  // Create commit
  const newCommitRes = await ghFetch(token, `/repos/${owner}/${repo}/git/commits`, "POST", {
    message: `submission: ${verb} ${tableName} table definition`,
    tree: treeSha,
    parents: [mainSha],
  });
  if (!newCommitRes.ok) { const e: any = await newCommitRes.json(); throw new Error(`Commit failed: ${e.message}`); }
  const newCommitSha = (await newCommitRes.json() as any).sha;

  // Create branch
  const branch = `submissions/${verb}/${tableName}`;
  const branchRes = await ghFetch(token, `/repos/${owner}/${repo}/git/refs`, "POST", {
    ref: `refs/heads/${branch}`,
    sha: newCommitSha,
  });
  if (!branchRes.ok) { const e: any = await branchRes.json(); throw new Error(`Branch failed: ${e.message}`); }

  // Open PR
  let prBody = `**Submitted by:** ${submitterName} (${submitterTeam})`;
  if (description) prBody += `\n\n**Notes:** ${description}`;

  const prRes = await ghFetch(token, `/repos/${owner}/${repo}/pulls`, "POST", {
    title: `submission: ${verb} ${tableName} table definition`,
    body: prBody,
    head: branch,
    base: "main",
  });
  if (!prRes.ok) { const e: any = await prRes.json(); throw new Error(`PR failed: ${e.message}`); }
  const { html_url } = await prRes.json() as { html_url: string };

  return { url: html_url };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = getAllowedOrigin(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);

    try {
      const token = await getInstallationToken(env);

      // GET /tables
      if (request.method === "GET" && url.pathname === "/tables") {
        const tables = await handleListTables(env, token);
        return json(tables, 200, origin);
      }

      // GET /table/:type/:name
      const tableMatch = url.pathname.match(/^\/table\/(data|definition)\/([^/]+)$/);
      if (request.method === "GET" && tableMatch) {
        const table = await handleFetchTable(env, token, tableMatch[1] as "data" | "definition", tableMatch[2]);
        return json(table, 200, origin);
      }

      // POST /submit
      if (request.method === "POST" && url.pathname === "/submit") {
        const body = await request.json();
        const result = await handleSubmit(env, token, body);
        return json(result, 200, origin);
      }

      return json({ error: "Not found" }, 404, origin);
    } catch (err: any) {
      return json({ error: err.message }, 500, origin);
    }
  },
};
