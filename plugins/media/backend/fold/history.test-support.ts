import { assert } from "@ryot-app/testing/assert";

import type { FoldEvent, HistoryChange } from "./history";

/** Applies a fold's history changes as the kernel would, naming created events by item identity. */
export const applyHistoryChanges = (
	events: ReadonlyArray<FoldEvent>,
	changes: ReadonlyArray<HistoryChange>,
) => {
	let next = [...events];
	const byId = (id: string) => {
		const found = next.find((value) => value.id === id);
		assert(found);
		return found;
	};
	for (const change of changes) {
		if (change.kind === "delete") {
			next = next.filter(({ id }) => id !== change.eventId);
		} else if (change.kind === "create") {
			const anchor = byId(change.item.orderAfter.eventId);
			next.push({
				revision: 0,
				eventSchemaSlug: "complete",
				entityId: change.item.entityId,
				occurredAt: change.item.occurredAt,
				properties: change.item.properties,
				id: `derived-${change.itemIdentity}`,
				orderCreatedAt: anchor.orderCreatedAt,
				sessionEntityId: change.item.sessionEntityId ?? null,
				orderKey: `${anchor.orderKey}~${change.item.orderAfter.suffix}`,
				entitySchemaSlug:
					change.item.entityId === anchor.entityId ? anchor.entitySchemaSlug : "show",
			});
		} else {
			const current = byId(change.item.eventId);
			const { patch } = change.item;
			const anchor = patch.orderAfter === null ? null : byId(patch.orderAfter.eventId);
			const properties = Object.fromEntries(
				Object.entries({ ...current.properties, ...patch.properties.set }).filter(
					([key]) => !patch.properties.remove.includes(key),
				),
			);
			next = next.map((value) =>
				value.id === current.id
					? {
							...current,
							properties,
							revision: current.revision + 1,
							occurredAt: patch.occurredAt ?? current.occurredAt,
							orderCreatedAt: anchor?.orderCreatedAt ?? current.orderCreatedAt,
							orderKey:
								anchor === null ? current.id : `${anchor.orderKey}~${patch.orderAfter?.suffix}`,
						}
					: value,
			);
		}
	}
	return next;
};
