import type {
	ChangeSet,
	ChangeSetEntityReference,
	ChangeSetGlobalEntityReference,
} from "@ryot-app/contract/modules/changes/change-set";
import type { EntityId } from "@ryot-app/contract/schema/brands";

export const rootEntity = { kind: "root" } as const satisfies ChangeSetEntityReference;

export const existingEntity = (entityId: EntityId) =>
	({ entityId, kind: "existing" }) as const satisfies ChangeSetEntityReference;

export const upsertedGlobalEntity = (entitySchemaSlug: string, externalId: string) =>
	({
		externalId,
		entitySchemaSlug,
		kind: "upserted",
	}) as const satisfies ChangeSetGlobalEntityReference;

const one = <Value>(values: ReadonlyArray<Value | undefined>, field: string) => {
	const present = values.filter((value) => value !== undefined);
	if (present.length > 1) {
		throw new Error(`Only one combined change set may set ${field}`);
	}
	return present[0];
};

const all = <Item>(values: ReadonlyArray<undefined | ReadonlyArray<Item>>) =>
	values.some((value) => value !== undefined) ? values.flatMap((value) => value ?? []) : undefined;

/**
 * Combines change sets that helpers built separately. Lists concatenate in argument order and
 * settings patches merge; the root entity, fold request, and expected session events may come from
 * only one of them.
 */
export const combineChangeSets = (...sets: ReadonlyArray<ChangeSet>): ChangeSet => {
	const entity = one(
		sets.map((set) => set.entity),
		"entity",
	);
	const folds = one(
		sets.map((set) => set.folds),
		"folds",
	);
	const settingsPatches = sets.flatMap((set) => (set.settings ? [set.settings] : []));
	const eventSets = sets.flatMap((set) => (set.events ? [set.events] : []));
	const expected = one(
		eventSets.map((events) => events.expected),
		"events.expected",
	);
	const baselines = all(eventSets.map((events) => events.baselines));
	const deletes = all(sets.map((set) => set.entities?.deletes));
	const clears = all(sets.map((set) => set.entities?.clears));
	const merges = all(sets.map((set) => set.entities?.merges));
	const ensures = all(sets.map((set) => set.entities?.ensures));
	const upserts = all(sets.map((set) => set.relationships?.upserts));
	const relationshipDeletes = all(sets.map((set) => set.relationships?.deletes));
	const signals = all(sets.map((set) => set.signals));
	const notifications = all(sets.map((set) => set.notifications));
	const globalEntities = all(sets.map((set) => set.globalEntities));
	const globalRelationships = all(sets.map((set) => set.globalRelationships));
	return {
		...(entity ? { entity } : {}),
		...(folds ? { folds } : {}),
		...(signals ? { signals } : {}),
		...(notifications ? { notifications } : {}),
		...(globalEntities ? { globalEntities } : {}),
		...(globalRelationships ? { globalRelationships } : {}),
		...(settingsPatches.length > 0
			? { settings: Object.fromEntries(settingsPatches.flatMap((patch) => Object.entries(patch))) }
			: {}),
		...(deletes || clears || merges || ensures
			? {
					entities: {
						...(deletes ? { deletes } : {}),
						...(clears ? { clears } : {}),
						...(merges ? { merges } : {}),
						...(ensures ? { ensures } : {}),
					},
				}
			: {}),
		...(upserts || relationshipDeletes
			? {
					relationships: {
						...(upserts ? { upserts } : {}),
						...(relationshipDeletes ? { deletes: relationshipDeletes } : {}),
					},
				}
			: {}),
		...(eventSets.length > 0
			? {
					events: {
						creates: eventSets.flatMap((events) => events.creates),
						changes: eventSets.flatMap((events) => events.changes),
						...(expected ? { expected } : {}),
						...(baselines ? { baselines } : {}),
					},
				}
			: {}),
	};
};
