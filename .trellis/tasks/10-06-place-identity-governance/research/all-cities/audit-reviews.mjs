// 只分析冻结目录，不访问数据库；提及/图片审核不能按实体对折叠。
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function groupPending(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id) ?? [];
    group.push(row);
    groups.set(id, group);
  }
  const assessed = [...groups.values()].filter(group => group.every(row => row.detail.assessment?.verdict === 'uncertain')).length;
  return { items: groups.size, assessedUncertain: assessed, unassessed: groups.size - assessed,
    duplicateRows: rows.length - groups.size };
}

export function auditReviews(entities, reviews, scopes = []) {
  const byId = new Map(entities.map(entity => [entity.entity_id, entity]));
  const scopeById = new Map(scopes.map(scope => [Number(scope.place_id), scope]));
  const failures = [];
  const root = (id, city) => {
    const seen = new Set();
    while (true) {
      const entity = byId.get(id);
      if (!entity || entity.city !== city || seen.has(id)) return undefined;
      seen.add(id);
      if (!entity.redirect_to) return entity;
      id = entity.redirect_to;
    }
  };
  const current = reviews.map(review => {
    const detail = review.detail ?? {};
    let reviewKind = 'entity_pair';
    let roots = [];
    let valid = true;
    const fail = kind => { failures.push({ reviewId: review.id, kind }); valid = false; };
    if (detail.reason === 'mention_scope') {
      reviewKind = 'mention';
      if (!positiveInteger(detail.mentionId) || !hash(detail.inputHash)
        || !Array.isArray(detail.scopePlaceIds) || !detail.scopePlaceIds.length
        || detail.scopePlaceIds.some(id => !positiveInteger(id))
        || new Set(detail.scopePlaceIds).size !== detail.scopePlaceIds.length) {
        fail('invalid_mention_review');
      } else if (review.status === 'PENDING'
        && detail.scopePlaceIds.some(id => scopeById.get(id)?.city !== review.city)) {
        fail('invalid_mention_scope');
      }
    } else if (detail.reason === 'image_scope') {
      reviewKind = 'image';
      // 缺失图片本身就是合法待审原因，不要求它仍存在于图库。
      if (typeof detail.imageKey !== 'string'
        || !/^(?:note_image:[1-9]\d*|photography:[^:\s]+:\d+)$/.test(detail.imageKey)
        || !hash(detail.inputHash) || typeof detail.statusReason !== 'string' || !detail.statusReason) {
        fail('invalid_image_review');
      }
    } else if (!Array.isArray(detail.entityIds) || detail.entityIds.length < 2
      || detail.entityIds.some(id => typeof id !== 'string' || !id)) {
      fail('invalid_entity_pair');
    } else {
      const resolved = detail.entityIds.map(id => root(id, review.city));
      if (resolved.some(entity => !entity)) fail('invalid_root');
      roots = [...new Map(resolved.filter(Boolean).map(entity => [entity.entity_id, entity])).values()]
        .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
      if (valid && review.status === 'PENDING' && roots.length < 2) fail('pending_same_root');
    }
    return { ...review, reviewKind, auditValid: valid,
      currentEntityIds: roots.map(entity => entity.entity_id), currentNames: roots.map(entity => entity.canonical_name) };
  });
  const cities = [...new Set([...entities, ...reviews].map(row => row.city))].sort().map(city => {
    const rows = current.filter(row => row.city === city);
    const pending = rows.filter(row => row.status === 'PENDING');
    const ofKind = kind => pending.filter(row => row.reviewKind === kind && row.auditValid);
    const pairs = groupPending(ofKind('entity_pair'), row => JSON.stringify([row.detail.reason, row.currentEntityIds]));
    // 同一提及/图片的不同证据版本分别待审，不能与历史版本相互抵消。
    const mentions = groupPending(ofKind('mention'), row => JSON.stringify([row.detail.mentionId, row.detail.inputHash]));
    const images = groupPending(ofKind('image'), row => JSON.stringify([row.detail.imageKey, row.detail.inputHash]));
    return { city, activeRoots: entities.filter(entity => entity.city === city && entity.status === 'ACTIVE' && !entity.redirect_to).length,
      statuses: Object.fromEntries(['PENDING', 'RESOLVED', 'REJECTED'].map(status => [status, rows.filter(row => row.status === status).length])),
      pendingPairRows: ofKind('entity_pair').length, pendingPairs: pairs.items,
      assessedUncertainPairs: pairs.assessedUncertain, unassessedPairs: pairs.unassessed,
      duplicatePendingRows: pairs.duplicateRows,
      pendingMentionRows: ofKind('mention').length, pendingMentions: mentions.items,
      assessedUncertainMentions: mentions.assessedUncertain, unassessedMentions: mentions.unassessed,
      duplicatePendingMentionRows: mentions.duplicateRows,
      pendingImageRows: ofKind('image').length, pendingImages: images.items,
      assessedUncertainImages: images.assessedUncertain, unassessedImages: images.unassessed,
      duplicatePendingImageRows: images.duplicateRows,
      invalidPendingRows: pending.filter(row => !row.auditValid).length };
  });
  return { reviews: current, cities, failures };
}
