import type { ShowEpisodeOrder } from "../../shared/show-episode-order";

export const showEpisodeOrderStorageKey = (showEntityId: string) => `episode-order:${showEntityId}`;

/**
 * The order a stored id picks. No stored id is aired order; an id the show no longer offers also
 * falls back to aired order and is `stale`, so the caller can forget it.
 */
export const resolveShowEpisodeOrder = (
	orders: readonly ShowEpisodeOrder[],
	storedId: string | null,
) => {
	const order = storedId === null ? null : (orders.find((o) => o.externalId === storedId) ?? null);
	return { order, stale: storedId !== null && order === null };
};

/**
 * The slice of a group's episode ids one page requests. The cursor is the offset of the page's
 * first id, so the next page starts where this one ends; `null` means the group is exhausted.
 */
export const showOrderEpisodePage = (
	externalIds: readonly string[],
	after: string | null,
	limit: number,
) => {
	const offset = after === null ? 0 : Number(after);
	const [first, ...rest] = externalIds.slice(offset, offset + limit);
	if (first === undefined) {
		return null;
	}
	const end = offset + 1 + rest.length;
	return {
		externalIds: [first, ...rest] as const,
		nextCursor: end < externalIds.length ? String(end) : null,
	};
};

/** Rows put back in the order their external ids appear in the group. */
export const orderByExternalIds = <Row extends { readonly externalId: string }>(
	rows: readonly Row[],
	externalIds: readonly string[],
) => {
	const positions = new Map<string, number>();
	externalIds.forEach((externalId, index) => {
		if (!positions.has(externalId)) {
			positions.set(externalId, index);
		}
	});
	const position = (row: Row) => positions.get(row.externalId) ?? externalIds.length;
	return [...rows].sort((left, right) => position(left) - position(right));
};
