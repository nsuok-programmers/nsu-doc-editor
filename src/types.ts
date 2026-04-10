export interface Column {
  name: string;
  type: string;
  description: string;
  definition_table: string;
}

export interface Query {
  name: string;
  description: string;
  file: string;
  sql: string;
}

export interface Table {
  name: string;
  description: string;
  type: 'data' | 'definition';
  tags: string[];
  columns: Column[];
  queries: Query[];
  definition_headers?: string[];
  definition_data?: string[][];
}

export type TablesMap = Record<string, Table>;
