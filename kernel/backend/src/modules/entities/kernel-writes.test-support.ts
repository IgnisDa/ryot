import {
	definitionOwner,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { EntityId, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import type { Changes } from "#modules/changes/changes";
import type { CommitResult } from "#modules/changes/receipts";
import { ChangeSets } from "#modules/changes/service";

import { EntitiesRepository } from "./repository";
import type { DomainLifecycleCommand } from "./write-context";

type EntityScope =
	{ readonly scope: "global" } | { readonly scope: "user"; readonly userId: UserId };
type EntityDeleteTarget = {
	readonly userId: null | UserId;
	readonly preserveHistory?: true;
	readonly entitySchema: EntitySchemaReference;
};
type EntityFields = {
	readonly name: string;
	readonly properties: unknown;
	readonly populatedAt?: Date | null;
	readonly lifecycle: DomainLifecycleCommand;
};
type EntityUpdateInput = EntityScope &
	EntityFields & {
		readonly entityId: EntityId;
		readonly entitySchema?: EntitySchemaReference;
		readonly expected?: { name: string; updatedAt: string; properties: unknown };
	};
type EntityWriteInput = EntityScope &
	EntityFields & {
		readonly updateExisting?: boolean;
		readonly externalId?: string | undefined;
		readonly entitySchema: EntitySchemaReference;
		readonly providerId?: undefined | SandboxProviderId;
	};

const scopeOf = (input: EntityScope) => (input.scope === "user" ? input.userId : null);

const populated = (input: EntityFields) =>
	input.populatedAt === undefined ? {} : { populatedAt: input.populatedAt?.toISOString() ?? null };

const saved = (result: CommitResult) => {
	const [written] = result.entities;
	return written ? Effect.succeed({ entity: written.entity }) : Effect.die("Nothing was saved");
};

const verbatim = { entities: { verbatimIdentities: true } } as const;

/**
 * Single kernel entity writes committed through `ChangeSets` under each write's own command identity.
 * An update without a schema or expected snapshot takes them from the stored entity.
 */
export const kernelEntityWrites = Effect.gen(function* () {
	const changes = yield* ChangeSets;
	const repository = yield* EntitiesRepository;
	const create = (input: EntityWriteInput) =>
		changes
			.commit(
				{
					userId: scopeOf(input),
					entities: {
						creates: [
							{
								name: input.name,
								properties: input.properties,
								entitySchema: input.entitySchema,
								itemIdentity: input.lifecycle.itemIdentity,
								...populated(input),
								...(input.externalId === undefined ? {} : { externalId: input.externalId }),
								...(input.providerId === undefined
									? {}
									: {
											provider: {
												providerId: input.providerId,
												updateExisting: input.updateExisting ?? false,
											},
										}),
							},
						],
					},
				},
				input.lifecycle,
				verbatim,
			)
			.pipe(Effect.flatMap(saved));
	const update = Effect.fnUntraced(function* (input: EntityUpdateInput) {
		const current = yield* repository.getById(input.entityId);
		const entitySchema =
			input.entitySchema ??
			(current
				? { slug: current.entitySchemaSlug, owner: definitionOwner(current.entitySchemaPluginId) }
				: undefined);
		if (!entitySchema) {
			return yield* Effect.die("An update of a missing entity names its schema");
		}
		const write = {
			entitySchema,
			name: input.name,
			properties: input.properties,
			itemIdentity: input.lifecycle.itemIdentity,
			target: {
				kind: "update" as const,
				entityId: input.entityId,
				expected:
					input.expected ??
					(current
						? { name: current.name, updatedAt: current.updatedAt, properties: current.properties }
						: { name: "", updatedAt: "", properties: {} }),
			},
			...populated(input),
		};
		return yield* changes
			.commit({ userId: scopeOf(input), entities: { updates: [write] } }, input.lifecycle, verbatim)
			.pipe(Effect.flatMap(saved));
	});
	const deleteByIds = (
		ids: ReadonlyArray<EntityId>,
		lifecycle: DomainLifecycleCommand,
		target: EntityDeleteTarget,
	) =>
		changes
			.commit(
				{
					userId: target.userId,
					entities: {
						deletes: ids.map((entityId) => ({
							entityId,
							entitySchema: target.entitySchema,
							...(target.preserveHistory ? { preserveHistory: true as const } : {}),
						})),
					},
				},
				lifecycle,
			)
			.pipe(Effect.map((result) => ({ deletedCount: result.deleted.length })));
	const ensure = (
		userId: UserId,
		items: NonNullable<NonNullable<Changes["entities"]>["ensures"]>,
		lifecycle: DomainLifecycleCommand,
	) => changes.commit({ userId, entities: { ensures: items } }, lifecycle);
	return { create, update, ensure, deleteByIds, upsert: create, getById: repository.getById };
});
