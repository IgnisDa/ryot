import { DbError } from "@ryot-app/contract/errors";
import {
	type AutomationPopulationContext,
	AutomationRelationshipDraft,
	type AutomationRelationshipRequestPayload,
	type AutomationRelationshipSnapshot,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import type { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import type { RelationshipSchemaDefinition } from "@ryot-app/definitions/snapshot";
import { Effect, Schema } from "effect";

import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import type { MutationEntity } from "#modules/entities/repository";
import {
	assertStableUnder,
	type DomainLifecycleCommand,
	type DomainWriteCheck,
	type DomainWritePin,
	writerPropertiesSchema,
} from "#modules/entities/write-context";
import { mutationUserIds } from "#modules/mutations/account-admission";
import { catalogDefinitionFingerprint } from "#modules/plugins/catalog/runtime-resolver";
import { type WriteScope, WriteTransaction } from "#platform/db/write-transaction";

import { isCollectionMember } from "./collection-order";
import {
	badProperties,
	emptyUserEntityScopes,
	equal,
	mergeProperties,
	type Mutation,
	parseProperties,
	relationshipChange,
	type RelationshipMutationDependencies,
	relationshipSchemaReference,
	relationshipWriteFailure,
	type RelationshipWriteResult,
	snapshot,
	type UserEntityScopes,
	validateUserRelationshipEntities,
} from "./mutation-support";
import { relationshipMutationLockKey, type RelationshipsRepository } from "./repository";

export type ValidatedMutation = {
	readonly active: RelationshipSchemaDefinition;
	readonly pinned: RelationshipSchemaDefinition;
};

export type MutationEntities = {
	readonly users: ReadonlyMap<UserId, UserEntityScopes>;
	readonly global: ReadonlyMap<EntityId, MutationEntity>;
};

/** A planned source to persist; a write carries its validation under the commit's locks. */
export type PersistedSource =
	| Exclude<PlannedSource, { readonly kind: "write" }>
	| ({ readonly validated: ValidatedMutation } & Extract<
			PlannedSource,
			{ readonly kind: "write" }
	  >);

type SourceRow = NonNullable<
	Effect.Success<ReturnType<RelationshipsRepository["Service"]["findRelationship"]>>
>;

/**
 * How a batch item stands against its locked row: unchanged, ensured by the earlier item of the
 * batch that writes its identity, or a write.
 */
type PlannedSource =
	| { readonly writer: number; readonly kind: "ensured" }
	| { readonly kind: "unchanged"; readonly row: null | SourceRow }
	| {
			readonly kind: "write";
			readonly row: null | SourceRow;
			readonly request: AutomationRelationshipRequestPayload;
			readonly before: null | AutomationRelationshipSnapshot;
	  };

export const mutationWriteCheck = (
	mutation: Pick<Mutation, "input" | "command">,
): DomainWriteCheck => ({
	command: mutation.command,
	owner: relationshipSchemaReference(mutation.input).owner,
	scopeUserId: mutation.input.scope === "user" ? mutation.input.userId : null,
});

const concurrentChange = () =>
	new RelationshipBadRequest({ reason: { code: "concurrent-relationship-change" } });

const assetForbidden = () => new RelationshipBadRequest({ reason: { code: "asset-forbidden" } });

const assertStableSource = (
	mutation: Mutation,
	validated: ValidatedMutation,
	source: null | AutomationRelationshipSnapshot,
) =>
	source && mutation.command.writeContext?.pluginRevision
		? assertStableUnder(
				"Relationship",
				writerPropertiesSchema(validated.pinned.propertiesSchema),
				source.properties,
				concurrentChange,
			)
		: Effect.void;

const draft = (
	request: Exclude<AutomationRelationshipRequestPayload, { operation: "delete" }>,
	properties: unknown,
) =>
	Schema.decodeUnknownEffect(AutomationRelationshipDraft)({ ...request.draft, properties }).pipe(
		Effect.mapError(() => badProperties([])),
	);

export const makeRelationshipMutationPrimitives = ({
	writes,
	runtime,
	session,
	planner,
	entities,
	admission,
	repository,
	definitions,
	assetReferences,
}: RelationshipMutationDependencies) => {
	const assertActiveTransaction = session.requireTransaction.pipe(
		Effect.mapError(
			() =>
				new DbError({ message: "Relationship mutation primitives require an active transaction" }),
		),
	);
	const verifyWrites = Effect.fnUntraced(function* (
		checks: ReadonlyArray<DomainWriteCheck>,
		transaction: WriteTransaction,
	) {
		const pinOf = yield* writes
			.checkMany(checks, transaction)
			.pipe(Effect.mapError(relationshipWriteFailure));
		return (mutation: Mutation) => pinOf(mutationWriteCheck(mutation));
	});
	const readEntities = Effect.fnUntraced(function* (mutations: ReadonlyArray<Mutation>) {
		const userEntityIds = new Map<UserId, EntityId[]>();
		const globalEntityIds: EntityId[] = [];
		for (const { input } of mutations) {
			const endpoints = [input.sourceEntityId, input.targetEntityId];
			if (input.scope === "user") {
				userEntityIds.set(input.userId, [...(userEntityIds.get(input.userId) ?? []), ...endpoints]);
			} else {
				globalEntityIds.push(...endpoints);
			}
		}
		const users = yield* Effect.forEach(userEntityIds, ([userId, entityIds]) =>
			entities
				.getEntityScopesForUser(entityIds, userId)
				.pipe(Effect.map((scopes) => [userId, scopes] as const)),
		);
		return {
			users: new Map(users),
			global: yield* entities.getMutationEntities(globalEntityIds),
		} satisfies MutationEntities;
	});
	const validateMutation = Effect.fnUntraced(function* (
		mutation: Mutation,
		reads: MutationEntities,
		scope: WriteScope,
		verified?: null | DomainWritePin,
	) {
		const reference = relationshipSchemaReference(mutation.input);
		if (
			mutation.command.writeContext?.pluginRevision &&
			mutation.command.kernelCollection === true &&
			reference.owner.kind === "kernel" &&
			reference.slug !== "member-of"
		) {
			return yield* new RelationshipBadRequest({
				reason: {
					code: "owner-mismatch",
					actual: reference.owner,
					expected: { kind: "plugin", pluginId: mutation.command.writeContext.pluginRevision.id },
				},
			});
		}
		const scopeUserId = mutation.input.scope === "user" ? mutation.input.userId : null;
		const pin =
			verified === undefined
				? yield* (
						scope instanceof WriteTransaction
							? writes.check(mutation.command, reference.owner, scopeUserId, scope)
							: writes.preparePin(mutation.command, reference.owner, scopeUserId, scope)
					).pipe(Effect.mapError(relationshipWriteFailure))
				: verified;
		const { pinned: declared, active: activeDeclaration } = yield* writes.resolvePinnedDeclaration(
			"relationship",
			pin,
			reference.owner,
			reference.slug,
		);
		let active: null | RelationshipSchemaDefinition = activeDeclaration
			? { ...activeDeclaration, pluginId: mutation.input.relationshipSchemaPluginId }
			: null;
		if (!activeDeclaration) {
			if (mutation.input.scope === "user") {
				active =
					(yield* definitions.findUserRelationshipSchemas(
						mutation.input.userId,
						[reference],
						scope,
					))[definitionKey("relationship", reference.owner, reference.slug)] ?? null;
			} else {
				active = yield* definitions.findGlobalRelationshipSchema(reference);
			}
		}
		if (!active) {
			return yield* new RelationshipNotFound({
				reason: { schema: reference, code: "relationship-schema-not-found" },
			});
		}
		if (pin && !declared) {
			return yield* concurrentChange();
		}
		const pinned = declared ? { ...declared, pluginId: active.pluginId } : active;
		const keyed = mutation.input.key !== undefined;
		if (
			keyed !== (active.keyed === true) ||
			keyed !== (pinned.keyed === true) ||
			(keyed && mutation.input.scope !== "user")
		) {
			return yield* new RelationshipBadRequest({ reason: { code: "invalid-relationship-key" } });
		}
		if (mutation.input.scope === "user") {
			yield* validateUserRelationshipEntities(
				reads.users.get(mutation.input.userId) ?? emptyUserEntityScopes(),
				mutation.input,
				{ ...pinned, userWritePolicy: active.userWritePolicy ?? pinned.userWritePolicy },
				mutation.input.userId,
			);
		} else {
			const source = reads.global.get(mutation.input.sourceEntityId);
			const target = reads.global.get(mutation.input.targetEntityId);
			if (
				!source ||
				!target ||
				source.userId !== null ||
				target.userId !== null ||
				(pinned.pluginId !== null &&
					(source.entity.entitySchemaPluginId !== pinned.pluginId ||
						target.entity.entitySchemaPluginId !== pinned.pluginId)) ||
				(pinned.sourceEntitySchemaSlug !== null &&
					(source.entity.entitySchemaSlug !== pinned.sourceEntitySchemaSlug ||
						source.entity.entitySchemaPluginId !== pinned.pluginId)) ||
				(pinned.targetEntitySchemaSlug !== null &&
					(target.entity.entitySchemaSlug !== pinned.targetEntitySchemaSlug ||
						target.entity.entitySchemaPluginId !== pinned.pluginId))
			) {
				return yield* concurrentChange();
			}
		}
		return { active, pinned } satisfies ValidatedMutation;
	});
	const prepareRequest = Effect.fnUntraced(function* (
		mutation: Mutation,
		before: null | AutomationRelationshipSnapshot,
		validated: ValidatedMutation,
	) {
		yield* assertActiveTransaction;
		yield* assertStableSource(mutation, validated, before);
		const expectedTarget = mutation.expectedTargetEntityId ?? mutation.input.targetEntityId;
		if (
			(before && before.targetEntityId !== expectedTarget) ||
			(!before && mutation.expectedTargetEntityId !== undefined)
		) {
			return yield* concurrentChange();
		}
		const { expectedProperties } = mutation;
		if (
			expectedProperties !== undefined &&
			(!before ||
				Object.entries(expectedProperties).some(
					([key, value]) => !equal(before.properties[key], value),
				))
		) {
			return yield* concurrentChange();
		}
		if (mutation.mode === "ensure" && before !== null) {
			return null;
		}
		if (!before && mutation.mode === "update") {
			return yield* new RelationshipNotFound({ reason: { code: "relationship-not-found" } });
		}
		if (mutation.mode === "delete") {
			return before
				? ({
						draft: before,
						category: "request",
						operation: "delete",
						resource: "relationship",
					} satisfies AutomationRelationshipRequestPayload)
				: null;
		}
		if (!mutation.propertiesSchema) {
			return yield* new DbError({ message: "Missing relationship property schema" });
		}
		const properties =
			mutation.mode === "merge"
				? mergeProperties(before?.properties, mutation.properties)
				: mutation.properties;
		const parsed = yield* parseProperties(
			properties,
			validated.pinned.propertiesSchema,
			Boolean(mutation.command.writeContext?.pluginRevision),
		);
		const value = yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
			sourceEntityId: mutation.input.sourceEntityId,
			...(mutation.input.key === undefined ? {} : { key: mutation.input.key }),
			targetEntityId: mutation.input.targetEntityId,
			relationshipSchemaSlug: mutation.input.relationshipSchemaSlug,
			relationshipSchemaPluginId: mutation.input.relationshipSchemaPluginId,
			properties: isCollectionMember(mutation.input)
				? { ...parsed, rank: before?.properties["rank"] ?? 0 }
				: parsed,
		}).pipe(Effect.mapError(() => badProperties([])));
		if (
			before &&
			before.targetEntityId === value.targetEntityId &&
			equal(before.properties, value.properties)
		) {
			return null;
		}
		return before
			? ({
					before,
					draft: value,
					category: "request",
					operation: "update",
					resource: "relationship",
				} satisfies AutomationRelationshipRequestPayload)
			: ({
					draft: value,
					category: "request",
					operation: "create",
					resource: "relationship",
				} satisfies AutomationRelationshipRequestPayload);
	});
	/** Revalidates a prepared request against the relationship's current `definition`. */
	const revalidateRequest = Effect.fnUntraced(function* (
		mutation: Mutation,
		request: AutomationRelationshipRequestPayload,
		validated: ValidatedMutation,
		definition: undefined | RelationshipSchemaDefinition,
	) {
		yield* assertActiveTransaction;
		if (request.operation === "delete") {
			return request;
		}
		if (
			!definition ||
			(definition.pluginId ?? null) !== (mutation.input.relationshipSchemaPluginId ?? null) ||
			!mutation.schemaFingerprint ||
			(!mutation.command.writeContext?.pluginRevision &&
				!equal(catalogDefinitionFingerprint(definition), mutation.schemaFingerprint))
		) {
			return yield* concurrentChange();
		}
		const properties = yield* parseProperties(
			request.draft.properties,
			validated.pinned.propertiesSchema,
			Boolean(mutation.command.writeContext?.pluginRevision),
		);
		const stored = yield* parseProperties(
			properties,
			definition.propertiesSchema,
			Boolean(mutation.command.writeContext?.pluginRevision),
		);
		if (!equal(stored, properties)) {
			return yield* concurrentChange();
		}
		const protectedProperties = isCollectionMember(mutation.input)
			? {
					...properties,
					rank: request.operation === "update" ? (request.before.properties["rank"] ?? 0) : 0,
				}
			: properties;
		return { ...request, draft: yield* draft(request, protectedProperties) };
	});
	/**
	 * Plans each item of a batch against its locked current row in `rows`: an item without a request
	 * stands unchanged unless its relationship changed since `before`, an ensure of an existing
	 * relationship stands unchanged, and an item whose identity an earlier item writes conflicts, unless
	 * it ensures a relationship that write leaves.
	 */
	const planSources = Effect.fnUntraced(function* (
		items: ReadonlyArray<{
			readonly mutation: Mutation;
			readonly before: null | AutomationRelationshipSnapshot;
			readonly request: null | AutomationRelationshipRequestPayload;
		}>,
		rows: ReadonlyMap<string, SourceRow>,
	) {
		const writers = new Map<
			string,
			{
				readonly index: number;
				readonly operation: AutomationRelationshipRequestPayload["operation"];
			}
		>();
		const planned: PlannedSource[] = [];
		for (const [index, { before, request, mutation }] of items.entries()) {
			const key = relationshipMutationLockKey(mutation.input);
			const writer = writers.get(key);
			if (writer !== undefined) {
				if (mutation.mode !== "ensure" || writer.operation === "delete") {
					return yield* concurrentChange();
				}
				planned.push({ kind: "ensured", writer: writer.index });
				continue;
			}
			const row = rows.get(key) ?? null;
			const current = row ? yield* snapshot(row) : null;
			const ensured = mutation.mode === "ensure" && current !== null;
			if (!ensured && request === null && !equal(current, before)) {
				return yield* concurrentChange();
			}
			if (ensured || request === null) {
				planned.push({ row, kind: "unchanged" });
				continue;
			}
			writers.set(key, { index, operation: request.operation });
			planned.push({ row, before, request, kind: "write" });
		}
		return planned;
	});
	/**
	 * Persists planned sources in one statement per operation, answering each item; a write whose
	 * relationship changed since `before` conflicts.
	 */
	const persistSources = Effect.fnUntraced(function* (
		transaction: WriteTransaction,
		items: ReadonlyArray<{ readonly mutation: Mutation; readonly source: PersistedSource }>,
	) {
		yield* assertActiveTransaction;
		const written = items.flatMap(({ source, mutation }) =>
			source.kind === "write" ? [{ ...source, mutation }] : [],
		);
		for (const { row, before, mutation, validated } of written) {
			const current = row ? yield* snapshot(row) : null;
			if (!equal(current, before)) {
				return yield* concurrentChange();
			}
			yield* assertStableSource(mutation, validated, current);
		}
		yield* assetReferences
			.lock(
				written.flatMap(({ request, mutation, validated }) =>
					request.operation === "delete"
						? []
						: [
								{
									properties: request.draft.properties,
									propertiesSchema: validated.active.propertiesSchema,
									ownerUserId: mutation.input.scope === "user" ? mutation.input.userId : null,
								},
							],
				),
			)
			.pipe(Effect.catchTag("ManagedAssetReferenceRejected", assetForbidden));
		const deleted = yield* repository.deleteRelationshipsById(
			written.flatMap(({ row, request }) =>
				request.operation === "delete" && row ? [row.id] : [],
			),
		);
		const updated = yield* repository.updateRelationshipsById(
			written.flatMap(({ row, request, mutation }) =>
				request.operation === "update" && row
					? [
							{
								id: row.id,
								properties: { ...request.draft.properties },
								targetEntityId: mutation.input.targetEntityId,
							},
						]
					: [],
			),
		);
		const created = yield* repository.createRelationships(
			transaction,
			written.flatMap(({ request, mutation }) =>
				request.operation === "create"
					? [{ ...mutation.input, properties: { ...request.draft.properties } }]
					: [],
			),
		);
		const results: Array<{
			readonly operation: RelationshipWriteResult["operation"];
			readonly payload: null | ReturnType<typeof relationshipChange>;
			readonly relationship: null | (SourceRow & { readonly wasInserted: boolean });
		}> = [];
		for (const { source, mutation } of items) {
			if (source.kind === "unchanged") {
				results.push({
					payload: null,
					operation: "noop",
					relationship: source.row ? { ...source.row, wasInserted: false } : null,
				});
				continue;
			}
			if (source.kind === "ensured") {
				const ensured = results[source.writer]?.relationship;
				if (!ensured) {
					return yield* Effect.die("An ensured relationship is missing the write it follows");
				}
				results.push({
					payload: null,
					operation: "noop",
					relationship: { ...ensured, wasInserted: false },
				});
				continue;
			}
			const { row, request } = source;
			let saved;
			if (request.operation === "create") {
				saved = created.get(relationshipMutationLockKey(mutation.input));
				if (saved && !saved.wasInserted) {
					return yield* concurrentChange();
				}
			} else if (row) {
				saved = (request.operation === "delete" ? deleted : updated).get(row.id);
			}
			if (!saved) {
				return yield* new RelationshipNotFound({ reason: { code: "relationship-not-found" } });
			}
			results.push({
				operation: request.operation,
				payload: relationshipChange(request, yield* snapshot(saved)),
				relationship: { ...saved, wasInserted: request.operation === "create" },
			});
		}
		return results;
	});
	const planChange = Effect.fnUntraced(function* (
		transaction: WriteTransaction,
		input: {
			mutation: Mutation;
			payload: ReturnType<typeof relationshipChange>;
			population?: DomainLifecycleCommand["population"];
		},
	) {
		yield* assertActiveTransaction;
		const { command } = input.mutation;
		const change = {
			...input.payload,
			...(input.population === undefined ? {} : { population: input.population }),
		};
		const dispatch = yield* planner.planChange(
			{
				trigger: yield* lifecycleTrigger(
					command,
					input.mutation.input.scope === "user" ? input.mutation.input.userId : null,
					change,
				),
			},
			transaction,
		);
		return { change, dispatch };
	});
	const lockMutations = Effect.fnUntraced(function* (
		mutations: ReadonlyArray<Mutation>,
		transaction?: WriteTransaction,
	) {
		yield* assertActiveTransaction;
		for (const { input, command } of mutations) {
			yield* admission.admitCommand(
				command,
				input.scope === "user" ? input.userId : null,
				transaction,
			);
		}
		yield* entities.lockEntityReferencesByIds(
			mutations.flatMap(({ input, expectedTargetEntityId }) => [
				input.sourceEntityId,
				input.targetEntityId,
				...(expectedTargetEntityId === undefined ? [] : [expectedTargetEntityId]),
			]),
		);
		yield* repository.lockRelationshipMutations(mutations.map(({ input }) => input));
		yield* runtime.lockCatalog(
			mutations.flatMap(({ input, command }) =>
				mutationUserIds(command, input.scope === "user" ? input.userId : null),
			),
			transaction,
		);
	});
	return {
		planChange,
		planSources,
		readEntities,
		verifyWrites,
		lockMutations,
		persistSources,
		prepareRequest,
		validateMutation,
		revalidateRequest,
	};
};

/** A population command's context with the relationship batch `id` its counts describe. */
export const relationshipPopulation = (
	command: DomainLifecycleCommand,
	id: string,
	counts: Pick<
		NonNullable<AutomationPopulationContext["batch"]>,
		"createdCount" | "updatedCount" | "deletedCount"
	>,
	beforeCount: number,
	isLeader: boolean,
) =>
	command.population
		? {
				...command.population,
				batch: {
					...counts,
					id,
					isLeader,
					beforeCount,
					afterCount: beforeCount + counts.createdCount - counts.deletedCount,
				},
			}
		: undefined;
