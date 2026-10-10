// ?page=&limit= → { data, page, limit, total }
function parsePaging(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  return { page, limit, skip: (page - 1) * limit };
}

async function paged(model, filter, query, sort, leanOptions) {
  const { page, limit, skip } = parsePaging(query);
  const [data, total] = await Promise.all([
    model.find(filter).sort(sort).skip(skip).limit(limit).lean(leanOptions),
    model.countDocuments(filter),
  ]);
  return { data, page, limit, total };
}

module.exports = { parsePaging, paged };
