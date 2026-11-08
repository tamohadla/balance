// The service has no browser/Auth imports; the page supplies the current client.
export function createItemsService(client, readAllRows) {
  async function unwrap(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  return {
    list() {
      return readAllRows(() =>
        client.from('items').select('*').order('created_at', { ascending: false }).order('id'),
      );
    },
    get(id, fields = '*') {
      return unwrap(client.from('items').select(fields).eq('id', id).single());
    },
    async exists({ item_name, color_code }) {
      const rows = await unwrap(
        client
          .from('items')
          .select('id')
          .eq('item_name', item_name)
          .eq('color_code', color_code)
          .limit(1),
      );
      return Boolean(rows?.length);
    },
    save(values, id = null) {
      const table = client.from('items');
      const query = id ? table.update(values).eq('id', id) : table.insert([values]);
      return unwrap(query.select().single());
    },
    setActive(id, isActive) {
      return unwrap(client.from('items').update({ is_active: isActive }).eq('id', id));
    },
    remove(id) {
      return unwrap(client.from('items').delete().eq('id', id));
    },
  };
}
