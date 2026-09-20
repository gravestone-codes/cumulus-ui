/** Bulk-import CSV parsing (id,display,url,user,password[,group]). Pure — unit-tested. */
export interface CsvRow {
  id: string;
  display_name: string;
  base_url: string;
  group?: string;
  switch_username: string;
  switch_password: string;
}

export function parseCsv(text: string): { rows: CsvRow[]; error: string | null } {
  const rows: CsvRow[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(',').map((p) => p.trim());
    const [id, display_name, base_url, switch_username, switch_password, group] = parts;
    if (!id || !display_name || !base_url || !switch_username || !switch_password) {
      return { rows: [], error: `bad line (need id,display,url,user,password[,group]): ${trimmed}` };
    }
    rows.push({ id, display_name, base_url, switch_username, switch_password, ...(group ? { group } : {}) });
  }
  if (rows.length === 0) return { rows: [], error: 'nothing to import' };
  if (rows.length > 200) return { rows: [], error: 'max 200 rows per import' };
  return { rows, error: null };
}
