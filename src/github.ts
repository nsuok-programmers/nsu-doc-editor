/**
 * github.ts
 * Handles all GitHub API interactions via the Cloudflare Worker.
 */

import { parseDat, serializeDat } from './parser.ts';
import type { Table, Query } from './types.ts';

const WORKER_URL = 'https://nsu-doc-editor-worker.nathantbeene.workers.dev';

interface SubmitOptions {
  tableName: string;
  tableType: 'data' | 'definition';
  jsonContent: string;
  queries: Query[];
  definitionData?: string[][];
  submitterName: string;
  submitterTeam: string;
  description?: string;
}

export async function submitTableDefinition(options: SubmitOptions): Promise<{ url: string }> {
  const res = await fetch(`${WORKER_URL}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  const data = await res.json() as { url?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Submission failed');
  return { url: data.url! };
}

export async function listRepoTables(): Promise<{ name: string; type: string }[]> {
  const res = await fetch(`${WORKER_URL}/tables`);
  const data = await res.json() as { name: string; type: string }[] | { error: string };
  if (!res.ok) throw new Error((data as { error: string }).error ?? 'Failed to list tables');
  return data as { name: string; type: string }[];
}

export async function fetchTableFromRepo(tableName: string, tableType = 'data'): Promise<Table> {
  const res = await fetch(`${WORKER_URL}/table/${tableType}/${tableName}`);
  const data = await res.json() as Table | { error: string };
  if (!res.ok) throw new Error((data as { error: string }).error ?? 'Failed to fetch table');

  const table = data as Table;

  // .dat content comes back as a raw string, parse it here
  if (tableType === 'definition' && typeof table.definition_data === 'string') {
    table.definition_data = parseDat(table.definition_data as unknown as string);
  }

  return table;
}
