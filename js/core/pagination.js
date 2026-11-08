/** Read every page from a query factory. The caller supplies a stable ordering. */
export async function readAllRows(makeQuery, { pageSize = 500 } = {}) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new RangeError('Page size must be an integer between 1 and 1000.');
  }
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await makeQuery().range(start, start + pageSize - 1);
    if (error) throw error;
    if (data != null && !Array.isArray(data)) throw new TypeError('Expected a row array.');
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}
