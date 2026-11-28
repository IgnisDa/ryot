import type { CommittedChanges } from "@ryot-app/contract/modules/changes/change-set";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import type {
	ClearEntityUserDataResponse,
	MergeEntityUserDataResponse,
} from "@ryot-app/contract/modules/entity-user-data/schemas";
import type { EventCreateItemOutcome } from "@ryot-app/contract/modules/events/schemas";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import type { LifecyclePlan } from "#modules/automations/lifecycle/planning";
import type { RelationshipWriteResult } from "#modules/relationships/mutation-support";

/**
 * What a commit wrote; `outcomes` lists every event create by position in independent-items mode,
 * `cleared` and `merged` each entity data clear and merge in order, `relationships` each user
 * relationship change, `entities` each saved root entity, entity create, update, reference and global
 * upsert, and `signals` each planned signal, under its item identity, and `deleted` every deleted
 * entity.
 */
export type CommitResult = {
	readonly committed: CommittedChanges;
	readonly deleted: ReadonlyArray<EntityId>;
	readonly outcomes: ReadonlyArray<EventCreateItemOutcome>;
	readonly merged: ReadonlyArray<MergeEntityUserDataResponse>;
	readonly cleared: ReadonlyArray<ClearEntityUserDataResponse>;
	readonly signals: ReadonlyArray<{ readonly plan: LifecyclePlan; readonly itemIdentity: string }>;
	readonly relationships: ReadonlyArray<
		RelationshipWriteResult & { readonly itemIdentity: string }
	>;
	readonly entities: ReadonlyArray<{
		readonly itemIdentity: string;
		readonly entity: ListedEntity;
	}>;
};

/** The result of a commit that wrote nothing. */
export const emptyCommitResult: CommitResult = {
	merged: [],
	signals: [],
	cleared: [],
	deleted: [],
	entities: [],
	outcomes: [],
	relationships: [],
	committed: { events: [] },
};

/** The one entity a commit saved. */
export const savedEntity = (result: CommitResult) => {
	const [saved] = result.entities;
	return saved ? Effect.succeed(saved.entity) : Effect.die("A commit saved no entity");
};
