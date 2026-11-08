/** Device-local drafts preserve incomplete inputs, including explicit zero. */
export function createReconciliationDraft({ storage, key }) {
  return {
    read() {
      try {
        const value = JSON.parse(storage.getItem(key) || 'null');
        if (!value || !Array.isArray(value.rows)) return null;
        const validInput = (input) =>
          input === null || (typeof input === 'number' && Number.isFinite(input));
        return {
          date: typeof value.date === 'string' ? value.date : '',
          rows: value.rows.filter(
            (row) =>
              typeof row?.id === 'string' &&
              validInput(row.actualMain) &&
              validInput(row.actualRolls),
          ),
        };
      } catch {
        return null;
      }
    },
    save(date, stateRows) {
      const rows = stateRows
        .filter((row) => row.actualMain !== null || row.actualRolls !== null)
        .map((row) => ({
          id: row.item.id,
          actualMain: row.actualMain,
          actualRolls: row.actualRolls,
        }));
      try {
        if (rows.length) storage.setItem(key, JSON.stringify({ date, rows }));
        else storage.removeItem(key);
        return { count: rows.length, saved: true };
      } catch {
        return { count: rows.length, saved: false };
      }
    },
  };
}
