import {
	type AutomationEntityChangePayload,
	AutomationEntityDraft,
	AutomationEntitySnapshot,
	AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { EntityBadRequest, type ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import {
	type DefinitionOwner,
	definitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { DateTime, Effect, Schema } from "effect";
import { chunksOf } from "effect/Array";

import type {
	ManagedAssetReferenceLocker,
	OwnedManagedAssetPropertyRecord,
} from "#lib/domain/managed-asset-writes";
import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import {
	type CommittedLifecycleWork,
	type LifecycleDispatchPlan,
	type LifecyclePlanner,
	toLifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import {
	MutationReceiptIdentity,
	MutationReceiptIdentityConflict,
	type MutationReceipts,
} from "#modules/mutations/receipts";
import { CatalogDefinitionFingerprint } from "#modules/plugins/catalog/runtime-resolver";
import { isUniqueConstraintError } from "#platform/db/errors";

import { type EntitiesRepository, type MutationEntity, STATEMENT_CHUNK_SIZE } from "./repository";
import { DomainLifecycleCommand, type DomainWritePin } from "./write-context";

export const PreparedEntityMutation = Schema.Struct({
	entityId: EntityId,
	draft: AutomationEntityDraft,
	receipt: MutationReceiptIdentity,
	lifecycle: DomainLifecycleCommand,
	scopeUserId: Schema.NullOr(UserId),
	before: Schema.NullOr(AutomationEntitySnapshot),
	entitySchemaPluginId: Schema.NullOr(Schema.String),
	requestId: Schema.NullOr(AutomationTrigger.fields.id),
	entitySchemaFingerprint: CatalogDefinitionFingerprint,
	operation: Schema.Literals(["create", "update", "delete"]),
});
export type PreparedMutation = typeof PreparedEntityMutation.Type;

export const snapshot = (entity: ListedEntity) =>
	Schema.decodeUnknownSync(AutomationEntitySnapshot)(entity);
export const draftOf = ({
	id: _id,
	createdAt: _createdAt,
	updatedAt: _updatedAt,
	...draft
}: AutomationEntitySnapshot) => draft;
export const same = (left: unknown, right: unknown) =>
	stableStringify(left) === stableStringify(right);
const conflict = (message: string) =>
	new EntityBadRequest({ reason: { message, code: "mutation-conflict" } });
const duplicateCollectionName = () =>
	new EntityBadRequest({ reason: { code: "duplicate-collection-name" } });
const isKernelCollection = (input: PreparedMutation) =>
	input.entitySchemaPluginId === null && input.draft.entitySchemaSlug === "collection";

const provenanceOf = (input: PreparedMutation) =>
	input.draft.externalId === null || input.draft.providerId === null
		? []
		: [
				{
					externalId: input.draft.externalId,
					providerId: input.draft.providerId,
					entitySchemaSlug: input.draft.entitySchemaSlug,
					entitySchemaPluginId: input.entitySchemaPluginId,
					...(input.scopeUserId === null
						? { scope: "global" as const }
						: { scope: "user" as const, userId: input.scopeUserId }),
				},
			];

export type PersistBatch = { readonly id: string; readonly hasCandidates: boolean };
export type PersistItem = {
	readonly batchIndex: number;
	readonly input: PreparedMutation;
	readonly preservePopulatedAt?: boolean;
	readonly pin: DomainWritePin | null | undefined;
};

const effectiveDraft = (item: PersistItem, before: AutomationEntitySnapshot) =>
	item.preservePopulatedAt && before.populatedAt !== null
		? { ...item.input.draft, populatedAt: before.populatedAt }
		: item.input.draft;
export type MutationReceiptRecord = Parameters<MutationReceipts["Service"]["insert"]>[0];

export const mutationReceiptRecord = (input: {
	readonly index: number;
	readonly result: unknown;
	readonly identity: MutationReceiptIdentity;
	readonly batch: PersistBatch | null | undefined;
	readonly dispatch: ReadonlyArray<LifecycleDispatchPlan>;
	readonly evidence?: MutationReceiptRecord["evidence"];
}): MutationReceiptRecord => ({
	result: input.result,
	identity: input.identity,
	dispatch: input.dispatch,
	...(input.batch ? { batchId: input.batch.id, batchIndex: input.index } : {}),
	...(input.batch?.hasCandidates && input.evidence ? { evidence: input.evidence } : {}),
});

// Above one statement's bind budget, chunks follow id order so receipt locks stay globally sorted.
const receiptChunks = <T>(items: ReadonlyArray<T>, idOf: (item: T) => string) => {
	const indexed = items.map((item, index) => ({ item, index, id: idOf(item) }));
	return items.length <= STATEMENT_CHUNK_SIZE
		? [indexed]
		: chunksOf(
				indexed.sort((left, right) => (left.id < right.id ? -1 : Number(left.id > right.id))),
				STATEMENT_CHUNK_SIZE,
			);
};

export const makeReceiptBatches = (receipts: MutationReceipts["Service"]) => ({
	insertReceipts: Effect.fnUntraced(function* (records: ReadonlyArray<MutationReceiptRecord>) {
		for (const chunk of receiptChunks(records, ({ identity }) => identity.id)) {
			yield* receipts.insertMany(chunk.map(({ item }) => item));
		}
	}),
	lookupReceipts: Effect.fnUntraced(function* <Result>(
		identities: ReadonlyArray<MutationReceiptIdentity>,
		codec: Schema.Codec<Result, unknown>,
	) {
		const results: Array<CommittedLifecycleWork<Result> | null> = identities.map(() => null);
		for (const chunk of receiptChunks(identities, ({ id }) => id)) {
			const found = yield* receipts.lookupMany(
				chunk.map(({ item }) => item),
				codec,
			);
			for (const [position, { index }] of chunk.entries()) {
				results[index] = found[position] ?? null;
			}
		}
		return results;
	}),
});

export const makePersistMutation = <E, R, Result>({
	planner,
	receipts,
	resultOf,
	repository,
	resultCodec,
	validateDraft,
	assetReferences,
	authorizeMutation,
}: {
	repository: EntitiesRepository["Service"];
	planner: LifecyclePlanner["Service"];
	receipts: MutationReceipts["Service"];
	assetReferences: ManagedAssetReferenceLocker["Service"];
	resultCodec: Schema.Codec<Result, unknown>;
	resultOf: (entity: ListedEntity, wasInserted: boolean) => Result;
	authorizeMutation: (mutation: PreparedMutation) => Effect.Effect<void, E, R>;
	validateDraft: (
		draft: AutomationEntityDraft,
		scopeUserId: UserId | null,
		owner: DefinitionOwner,
		lifecycle: DomainLifecycleCommand,
		commit?: boolean,
		pin?: DomainWritePin | null,
	) => Effect.Effect<
		Pick<PreparedMutation, "draft" | "entitySchemaFingerprint"> & { propertiesSchema: AppSchema },
		E,
		R
	>;
}) => {
	const lockRows = Effect.fnUntraced(function* (inputs: ReadonlyArray<PreparedMutation>) {
		const entityIds = inputs.map(({ entityId }) => entityId);
		yield* repository.lockProviderEntityMutations(inputs.flatMap(provenanceOf));
		yield* repository.lockMutationKeys(entityIds);
		return yield* repository.getMutationEntities(entityIds, true);
	});
	const persistMany = Effect.fnUntraced(function* (
		items: ReadonlyArray<PersistItem>,
		batch?: PersistBatch,
		locked?: ReadonlyMap<EntityId, MutationEntity>,
	) {
		const assetRecords: OwnedManagedAssetPropertyRecord[] = [];
		for (const { pin, input } of items) {
			const currentSchema = yield* validateDraft(
				input.draft,
				input.scopeUserId,
				definitionOwner(input.entitySchemaPluginId),
				input.lifecycle,
				true,
				pin,
			);
			if (!same(currentSchema.draft, input.draft)) {
				return yield* conflict("Entity schema changed before the source write committed");
			}
			if (input.operation !== "delete") {
				assetRecords.push({
					ownerUserId: input.scopeUserId,
					properties: input.draft.properties,
					propertiesSchema: currentSchema.propertiesSchema,
				});
			}
		}
		yield* assetReferences
			.lock(assetRecords)
			.pipe(
				Effect.catchTag(
					"ManagedAssetReferenceRejected",
					() => new EntityBadRequest({ reason: { code: "asset-forbidden" } }),
				),
			);
		const rows = locked ?? (yield* lockRows(items.map(({ input }) => input)));
		const writes: Array<{ item: PersistItem; before: AutomationEntitySnapshot | null }> = [];
		for (const item of items) {
			const { input } = item;
			const current = rows.get(input.entityId) ?? null;
			const before = current ? snapshot(current.entity) : null;
			if (
				current &&
				(current.userId !== input.scopeUserId ||
					(current.entity.entitySchemaPluginId ?? null) !== input.entitySchemaPluginId ||
					current.entity.entitySchemaSlug !== input.draft.entitySchemaSlug)
			) {
				return yield* conflict("Entity scope changed");
			}
			if (before && input.lifecycle.writeContext?.pluginRevision) {
				const parsed = yield* validateDraft(
					draftOf(before),
					input.scopeUserId,
					definitionOwner(input.entitySchemaPluginId),
					input.lifecycle,
					false,
					item.pin,
				).pipe(
					Effect.mapError(() =>
						conflict("Current entity cannot be processed by the pinned writer"),
					),
				);
				if (!same(parsed.draft.properties, before.properties)) {
					return yield* conflict("Pinned entity constraints would change the current stored value");
				}
			}
			if (input.operation === "create") {
				if (before && !same(draftOf(before), input.draft)) {
					return yield* conflict("Command identity was reused with a different entity payload");
				}
			} else if (!before || !same(before, input.before)) {
				return yield* conflict("Entity changed while policies ran; resubmit with a new command");
			}
			writes.push({ item, before });
		}
		const [firstDelete, ...otherDeletes] = writes.flatMap(({ item }) =>
			item.input.operation === "delete" ? [item.input.entityId] : [],
		);
		if (firstDelete) {
			yield* repository.deleteByIds([firstDelete, ...otherDeletes]);
		}
		const creates = writes.flatMap(({ item, before }) =>
			item.input.operation === "create" && before === null ? [item.input] : [],
		);
		const inserted = new Map(
			(yield* repository.insertEntities(
				creates.map((input) => ({
					id: input.entityId,
					name: input.draft.name,
					properties: input.draft.properties,
					entitySchemaSlug: input.draft.entitySchemaSlug,
					entitySchemaPluginId: input.entitySchemaPluginId,
					createdAt: DateTime.toDateUtc(DateTime.makeUnsafe(input.lifecycle.occurredAt)),
					populatedAt:
						input.draft.populatedAt === null
							? null
							: DateTime.toDateUtc(DateTime.makeUnsafe(input.draft.populatedAt)),
					...(input.draft.externalId === null ? {} : { externalId: input.draft.externalId }),
					...(input.draft.providerId === null ? {} : { providerId: input.draft.providerId }),
					...(input.scopeUserId === null
						? { scope: "global" as const }
						: { scope: "user" as const, userId: input.scopeUserId }),
				})),
			)).map((entity) => [entity.id, entity]),
		);
		for (const input of creates) {
			if (inserted.has(input.entityId)) {
				continue;
			}
			if (
				input.scopeUserId !== null &&
				isKernelCollection(input) &&
				(yield* repository.hasUserCollectionNamed({
					name: input.draft.name,
					userId: input.scopeUserId,
				}))
			) {
				return yield* duplicateCollectionName();
			}
			return yield* conflict(
				"Provider identity changed while policies ran; resubmit with a new command",
			);
		}
		const results: Array<{ result: Result; dispatch: ReadonlyArray<LifecycleDispatchPlan> }> = [];
		const records: MutationReceiptRecord[] = [];
		for (const { item, before } of writes) {
			const { input } = item;
			let entity: ListedEntity | null = before;
			let change: AutomationEntityChangePayload | undefined;
			if (input.operation === "delete") {
				change = before
					? { before, category: "change", resource: "entity", operation: "delete" }
					: undefined;
			} else if (input.operation === "create") {
				const created = inserted.get(input.entityId);
				if (created) {
					entity = created;
					change = {
						category: "change",
						resource: "entity",
						operation: "create",
						after: snapshot(created),
					};
				}
			} else if (before && !same(draftOf(before), effectiveDraft(item, before))) {
				entity = yield* repository
					.updateEntity({
						name: input.draft.name,
						entityId: input.entityId,
						properties: input.draft.properties,
						populatedAt:
							input.draft.populatedAt === null
								? null
								: DateTime.toDateUtc(DateTime.makeUnsafe(input.draft.populatedAt)),
						...(item.preservePopulatedAt ? { preservePopulatedAt: true } : {}),
					})
					.pipe(
						Effect.catchIf(
							isUniqueConstraintError("entity_collection_name_unique"),
							duplicateCollectionName,
						),
					);
				change = {
					before,
					category: "change",
					resource: "entity",
					operation: "update",
					after: snapshot(entity),
				};
			}
			if (!entity) {
				return yield* conflict("Entity changed while policies ran; resubmit with a new command");
			}
			const evidence = change
				? {
						...change,
						...(input.lifecycle.population ? { population: input.lifecycle.population } : {}),
					}
				: undefined;
			const plan = evidence
				? yield* planner.plan({
						trigger: lifecycleTrigger(
							{
								...input.lifecycle,
								causation: {
									...input.lifecycle.causation,
									parentTriggerId: input.requestId ?? input.lifecycle.causation.parentTriggerId,
								},
							},
							input.scopeUserId,
							evidence,
						),
					})
				: null;
			const dispatch = plan?.trigger ? [toLifecycleDispatchPlan(plan)] : [];
			const result = resultOf(entity, input.operation === "create" && before === null);
			results.push({ result, dispatch });
			records.push(
				mutationReceiptRecord({
					batch,
					result,
					evidence,
					dispatch,
					index: item.batchIndex,
					identity: input.receipt,
				}),
			);
		}
		return { results, records };
	});
	const persistSave = Effect.fnUntraced(function* (
		input: PreparedMutation,
		batch?: PersistBatch & { readonly index: number },
	) {
		yield* repository.lockSchemaCatalog();
		yield* authorizeMutation(input);
		const replay = yield* receipts
			.lookup(input.receipt, resultCodec)
			.pipe(
				Effect.mapError((error) =>
					error instanceof MutationReceiptIdentityConflict
						? conflict("Command identity was reused with a different entity payload")
						: error,
				),
			);
		if (replay) {
			return { result: replay.result, dispatch: replay.dispatch };
		}
		const persisted = yield* persistMany(
			[{ input, pin: undefined, batchIndex: batch?.index ?? 0 }],
			batch,
		);
		const [saved] = persisted.results;
		const [record] = persisted.records;
		if (!saved || !record) {
			return yield* Effect.die("Persisted entity mutation is missing its result");
		}
		yield* receipts.insert(record);
		return saved;
	});
	return { persistMany, persistSave };
};
