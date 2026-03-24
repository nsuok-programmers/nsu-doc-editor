/**
 * parser.js
 * Parses Banner .info file text into a structured table object.
 * Logic mirrors convert.py exactly.
 */

/**
 * @param {string} text - Raw contents of a .info file
 * @returns {Object} Parsed table definition
 */
export function parseInfo(text) {
  const lines = text.split(/\r?\n/);

  const result = {
    name: '',
    description: '',
    type: 'data',
    tags: [],
    queries: [],
    columns: []
  };

  // Extract table name
  for (const line of lines) {
    const m = line.match(/^TABLE:\s*(\S+)/);
    if (m) { result.name = m[1]; break; }
  }

  // Extract table comment
  for (const line of lines) {
    const m = line.match(/^\s*COMMENTS\s*:(.*)/);
    if (m) { result.description = m[1].trim(); break; }
  }

  // Find column section start (line after the header row)
  let colStart = null;
  for (let i = 0; i < lines.length; i++) {
    if (/\s*NAME\s+DATA TYPE\s+NULL/.test(lines[i])) {
      colStart = i + 1;
      break;
    }
  }

  if (colStart === null) return result;

  // Find column section end
  let colEnd = lines.length;
  for (let i = colStart; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s === '' || s.startsWith('Indexes') || s.startsWith('INDEX_NAME')) {
      colEnd = i;
      break;
    }
  }

  // Column pattern — mirrors convert.py regex
  // Leading space or * (primary key indicator), uppercase name, data type, nullable, remainder
  const colPattern = /^[\s*]([A-Z][A-Z0-9_]+)\s+([\w()., ]+?)\s{2,}(Yes|No)\s*(.*)/;

  const columns = [];
  let current = null;

  for (let i = colStart; i < colEnd; i++) {
    const line = lines[i];
    const m = line.match(colPattern);

    if (m) {
      if (current) columns.push(current);
      current = {
        name: m[1].trim(),
        type: m[2].trim(),
        nullable: m[3].trim(),
        description: m[4].trim(),
        definition_table: ''
      };
    } else if (current && line.trim()) {
      // Continuation line — append to description
      current.description += ' ' + line.trim();
    }
  }
  if (current) columns.push(current);

  // Clean up multi-space artifacts from column-aligned formatting
  for (const col of columns) {
    col.description = col.description.replace(/\s{2,}/g, ' ').trim();
  }

  result.columns = columns;
  return result;
}

/**
 * Strips internal UI-only fields before exporting JSON.
 * @param {Object} table
 * @returns {Object} Clean table object safe to write to disk
 */
export function toExportJson(table) {
  return {
    ...table,
    queries: table.queries.map(({ sql, ...rest }) => rest)
  };
}
