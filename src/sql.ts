export function validateReadOnlySql(sql: string) {
  if (sql.length > 10_000) throw new Error('Queries are limited to 10,000 characters.');
  const tokens: string[] = [];
  let semicolons = 0;
  let lastSignificant = '';
  for (let index = 0; index < sql.length;) {
    const char = sql[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '-' && sql[index + 1] === '-') {
      index += 2;
      while (index < sql.length && sql[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && sql[index + 1] === '*') {
      const close = sql.indexOf('*/', index + 2);
      if (close < 0) throw new Error('SQL has an unclosed block comment.');
      index = close + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const closeChar = char === '[' ? ']' : char;
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === closeChar) {
          if (sql[index + 1] === closeChar && closeChar !== ']') { index += 2; continue; }
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) throw new Error('SQL has an unclosed quoted value or identifier.');
      lastSignificant = 'quoted';
      continue;
    }
    if (char === ';') {
      semicolons += 1;
      lastSignificant = ';';
      index += 1;
      continue;
    }
    const word = sql.slice(index).match(/^[a-z_][a-z0-9_$]*/i)?.[0];
    if (word) {
      const upper = word.toUpperCase();
      tokens.push(upper);
      lastSignificant = upper;
      index += word.length;
      continue;
    }
    lastSignificant = char;
    index += 1;
  }
  if (semicolons > 1 || (semicolons === 1 && lastSignificant !== ';')) throw new Error('Run one SQL statement at a time.');
  if (!['SELECT', 'WITH'].includes(tokens[0] ?? '')) throw new Error('Only read-only SELECT queries are allowed.');
  const blocked = new Set(['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'DROP', 'ALTER', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'REINDEX', 'ANALYZE', 'LOAD_EXTENSION', 'RANDOMBLOB', 'ZEROBLOB', 'READFILE', 'WRITEFILE']);
  if (tokens.some((token) => blocked.has(token))) throw new Error('The query contains a write or database administration command.');
  if (tokens[0] === 'WITH' && !tokens.includes('SELECT')) throw new Error('WITH queries must finish with a SELECT statement.');
}