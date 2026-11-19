import { assert } from "@ryot-app/testing/assert";

import type { FoldEvent, HistoryChange } from "./history";

const find = (list: ReadonlyArray<FoldEvent>, id: string) => {
	const found = list.find((value) => value.id === id);
	assert(found);
	return found;
};

/**
 * Applies a fold's history changes as the kernel would, naming created events by item identity and
 * capturing each order anchor as it stood before the changes. An output off its anchor's entity is
 * on the subject.
 */
export const applyHistoryChanges = (
	events: ReadonlyArray<FoldEvent>,
	changes: ReadonlyArray<HistoryChange>,
	subjectSchemaSlug: string,
) => {
	let next = [...events];
	const anchored = (
		entityId: string,
		orderAfter: { readonly suffix: string; readonly eventId: string },
	) => {
		const anchor = find(events, orderAfter.eventId);
		return {
			orderCreatedAt: anchor.orderCreatedAt,
			orderKey: `${anchor.orderKey}~${orderAfter.suffix}`,
			entitySchemaSlug: entityId === anchor.entityId ? anchor.entitySchemaSlug : subjectSchemaSlug,
		};
	};
	for (const change of changes) {
		if (change.kind === "delete") {
			next = next.filter(({ id }) => id !== change.eventId);
		} else if (change.kind === "create") {
			next.push({
				...anchored(change.item.entityId, change.item.orderAfter),
				revision: 0,
				eventSchemaSlug: "complete",
				entityId: change.item.entityId,
				occurredAt: change.item.occurredAt,
				properties: change.item.properties,
				id: `derived-${change.itemIdentity}`,
				sessionEntityId: change.item.sessionEntityId ?? null,
			});
		} else {
			const current = find(next, change.item.eventId);
			const { patch } = change.item;
			const entityId = patch.entityId ?? current.entityId;
			const properties = Object.fromEntries(
				Object.entries({ ...current.properties, ...patch.properties.set }).filter(
					([key]) => !patch.properties.remove.includes(key),
				),
			);
			next = next.map((value) =>
				value.id === current.id
					? {
							...current,
							entityId,
							properties,
							revision: current.revision + 1,
							occurredAt: patch.occurredAt ?? current.occurredAt,
							sessionEntityId:
								patch.sessionEntityId === undefined
									? current.sessionEntityId
									: patch.sessionEntityId,
							...(patch.orderAfter === undefined ? {} : anchored(entityId, patch.orderAfter)),
						}
					: value,
			);
		}
	}
	return next;
};
