import { DbError } from "@ryot-app/contract/errors";
import type {
	AutomationRelationshipRequestPayload,
	AutomationRelationshipSnapshot,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	definitionKey,
	definitionOwner,
	type RelationshipSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import type { EntityId, RelationshipId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";
import { zip } from "effect/Array";

import type { LifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import {
	acceptedPolicyRequests,
	matchPolicies,
	type PolicyDecisions,
} from "#modules/automations/lifecycle/policies";
import {
	type PreparedEntityCreate,
	preparedEntityCreateData,
} from "#modules/entities/prepared-entity-create";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import { catalogDefinitionFingerprint } from "#modules/plugins/catalog/runtime-resolver";
import type { WritePreparation, WriteTransaction } from "#platform/db/write-transaction";

import {
	makeRelationshipMutationPrimitives,
	type MutationEntities,
	mutationWriteCheck,
} from "./mutation-primitives";
import {
	activeTransactionGuard,
	type Mutation,
	recordRelationshipImportItem,
	relationshipIdentity,
	type RelationshipMutationDependencies,
	relationshipSchemaReference,
	relationshipWriteFailure,
	type RelationshipWriteResult,
	rootTransaction,
	rootTransactionGuard,
	snapshot,
	type UserRelationshipInput,
	type UserRelationshipWrite,
} from "./mutation-support";
import { relationshipMutationLockKey } from "./repository";

export type UserRelationshipMode = "merge" | "upsert" | "update" | "ensure";
/**
 * A user relationship write validated before its commit, with the request its policies receive;
 * persistence revalidates it under locks. A null request writes nothing.
 */
export type PreparedUserRelationship = {
	readonly mutation: Mutation;
	readonly before: null | AutomationRelationshipSnapshot;
	readonly request: null | AutomationRelationshipRequestPayload;
};
/** A user relationship change a commit prepares: a write in its mode, or a delete by its endpoints. */
export type UserRelationshipChange =
	| {
			readonly mode: "delete";
			readonly input: UserRelationshipInput;
			readonly command: DomainLifecycleCommand;
	  }
	| {
			readonly mode: UserRelationshipMode;
			readonly input: UserRelationshipWrite;
			readonly command: DomainLifecycleCommand;
			readonly expected?: RelationshipExpectation;
	  };
/** What a write expects of the relationship it changes: its target, and property values it holds. */
type RelationshipExpectation = {
	readonly targetEntityId?: EntityId;
	readonly properties?: Readonly<Record<string, unknown>>;
};
type RequestedRelationship = {
	readonly mutation: Mutation;
	readonly token: PreparedUserRelationship;
	readonly request: AutomationRelationshipRequestPayload;
};

const prepared = (data: PreparedUserRelationship): PreparedUserRelationship => Object.freeze(data);

/** The endpoints a prepared relationship write references. */
export const preparedRelationshipEntityIds = ({
	mutation,
}: PreparedUserRelationship): ReadonlyArray<EntityId> => [
	mutation.input.sourceEntityId,
	mutation.input.targetEntityId,
	...(mutation.expectedTargetEntityId === undefined ? [] : [mutation.expectedTargetEntityId]),
];

const concurrentChange = () =>
	new RelationshipBadRequest({ reason: { code: "concurrent-relationship-change" } });

/** Matches the policies of every prepared write with a request, in the caller's transaction. */
export const matchRelationshipPolicies = (input: {
	readonly userId: UserId;
	readonly transaction: WriteTransaction;
	readonly command: DomainLifecycleCommand;
	readonly prepared: ReadonlyArray<PreparedUserRelationship>;
}) =>
	matchPolicies(
		{
			userId: input.userId,
			command: input.command,
			resource: "relationship",
			items: input.prepared.flatMap((token): ReadonlyArray<RequestedRelationship> => {
				const { request, mutation } = token;
				return request === null ? [] : [{ token, request, mutation }];
			}),
			policyItem: ({ request, mutation }) => ({
				request,
				subject: mutation.input.sourceEntityId,
				itemIdentity: mutation.command.itemIdentity,
				propertiesSchema: mutation.propertiesSchema ?? null,
			}),
		},
		input.transaction,
	);

/**
 * Each prepared write with its policy decision applied; a refused item fails. A write without a
 * request, or outside the decided chunks, stands as prepared.
 */
export const acceptRelationshipPolicies = (
	chunks: ReadonlyArray<{ readonly decisions: PolicyDecisions }>,
) => {
	const accepted = acceptedPolicyRequests(chunks);
	return Effect.fnUntraced(function* (token: PreparedUserRelationship) {
		const decision = yield* accepted(token.mutation.command.itemIdentity);
		if (decision === null) {
			return token;
		}
		const { request } = decision;
		if (request.resource !== "relationship") {
			return yield* Effect.die("A relationship policy decided another resource");
		}
		return prepared({ ...token, request });
	});
};

// An endpoint that its caller creates in the same commit does not exist yet, so its schema is taken
// from the creation token. Persistence validates against the stored entity.
const withCreatedEndpoints = (
	reads: MutationEntities,
	createdEntities: ReadonlyArray<PreparedEntityCreate>,
): MutationEntities => {
	const users = new Map(reads.users);
	for (const created of createdEntities.map(preparedEntityCreateData)) {
		const scopes = users.get(created.userId);
		if (scopes !== undefined) {
			users.set(
				created.userId,
				new Map(scopes).set(created.entityId, {
					entityName: "",
					entityId: created.entityId,
					entityUserId: created.userId,
					entitySchemaSlug: created.entitySchemaSlug,
					isBuiltin: created.entitySchemaPluginId === null,
					entitySchemaPluginId: created.entitySchemaPluginId,
				}),
			);
		}
	}
	return { ...reads, users };
};

/** The relationship schemas each user's writes name, read once per user. */
const writtenSchemas = (
	changes: ReadonlyArray<{
		readonly userId: UserId;
		readonly reference: RelationshipSchemaReference;
	}>,
) => {
	const byUser = new Map<UserId, RelationshipSchemaReference[]>();
	for (const { userId, reference } of changes) {
		byUser.set(userId, [...(byUser.get(userId) ?? []), reference]);
	}
	return byUser;
};

/**
 * User relationship writes prepared outside the commit. Their caller runs their policies once per
 * batch, matching them in its prepare transaction, applying them outside it, and accepting each item's
 * decision before persisting the batch in its commit transaction, whose resource batches it seals.
 */
export const makePreparedRelationshipMutations = (
	dependencies: RelationshipMutationDependencies,
) => {
	const { keys, writes, session, planner, repository, definitions } = dependencies;
	const primitives = makeRelationshipMutationPrimitives(dependencies);
	const inRootTransaction = rootTransaction(session);
	const assertRootTransaction = rootTransactionGuard(session);
	const assertActiveTransaction = activeTransactionGuard(session);
	/**
	 * Prepares user relationship changes as one set, answering each in order: their schemas in one read
	 * per user, then one short transaction that locks, reads the endpoints of and looks up every
	 * relationship once.
	 */
	const prepareUserChanges = Effect.fn("RelationshipsService.prepareUserChanges")(function* (
		preparation: WritePreparation,
		changes: ReadonlyArray<UserRelationshipChange>,
		createdEntities: ReadonlyArray<PreparedEntityCreate> = [],
	) {
		yield* assertRootTransaction;
		if (changes.length === 0) {
			return [];
		}
		const identified = yield* Effect.forEach(changes, (change) =>
			Effect.gen(function* () {
				const input = relationshipIdentity(change.input);
				if (input.scope !== "user") {
					return yield* new DbError({
						message: "Prepared relationship mutations require user scope",
					});
				}
				const command = yield* Schema.decodeEffect(DomainLifecycleCommand)(change.command).pipe(
					Effect.mapError(
						() => new RelationshipBadRequest({ reason: { code: "lifecycle-command-conflict" } }),
					),
				);
				const pin = yield* writes
					.preparePin(command, relationshipSchemaReference(input).owner, input.userId, preparation)
					.pipe(Effect.mapError(relationshipWriteFailure));
				return { pin, input, change, command };
			}),
		);
		const schemas = yield* Effect.forEach(
			writtenSchemas(
				identified.flatMap(({ input, change }) =>
					change.mode === "delete"
						? []
						: [{ userId: input.userId, reference: relationshipSchemaReference(input) }],
				),
			),
			([userId, references]) =>
				Effect.map(
					definitions.findUserRelationshipSchemas(userId, references, preparation),
					(found) => [userId, found] as const,
				),
		).pipe(Effect.map((found) => new Map(found)));
		const mutations = yield* Effect.forEach(identified, ({ pin, input, change, command }) =>
			Effect.gen(function* () {
				const expected = change.mode === "delete" ? {} : (change.expected ?? {});
				const mutation: Mutation = {
					input,
					command,
					mode: change.mode,
					...(expected.targetEntityId === undefined
						? {}
						: { expectedTargetEntityId: expected.targetEntityId }),
					...(expected.properties === undefined ? {} : { expectedProperties: expected.properties }),
				};
				if (change.mode === "delete") {
					return { pin, mutation };
				}
				const reference = relationshipSchemaReference(input);
				const definition = schemas.get(input.userId)?.[
					definitionKey("relationship", reference.owner, reference.slug)
				];
				if (!definition) {
					return yield* new RelationshipNotFound({
						reason: { schema: reference, code: "relationship-schema-not-found" },
					});
				}
				if (
					!Object.is(input.relationshipSchemaPluginId, undefined) &&
					!Object.is(input.relationshipSchemaPluginId, definition.pluginId ?? null)
				) {
					return yield* concurrentChange();
				}
				return {
					pin,
					mutation: {
						...mutation,
						properties: change.input.properties,
						propertiesSchema: definition.propertiesSchema,
						schemaFingerprint: catalogDefinitionFingerprint(definition),
						input: { ...input, relationshipSchemaPluginId: definition.pluginId ?? null },
					},
				};
			}),
		);
		return yield* inRootTransaction(
			Effect.gen(function* () {
				const all = mutations.map(({ mutation }) => mutation);
				yield* primitives.lockMutations(all);
				const reads = withCreatedEndpoints(yield* primitives.readEntities(all), createdEntities);
				const validated = yield* Effect.forEach(mutations, ({ pin, mutation }) =>
					Effect.map(
						primitives.validateMutation(mutation, reads, preparation, pin),
						(validation) => ({ mutation, validation }),
					),
				);
				const rows = yield* repository.findRelationships(all.map(({ input }) => input));
				return yield* Effect.forEach(validated, ({ mutation, validation }) =>
					Effect.gen(function* () {
						const row = rows.get(relationshipMutationLockKey(mutation.input));
						const before = row ? yield* snapshot(row) : null;
						const request = yield* primitives.prepareRequest(mutation, before, validation);
						return prepared({ before, request, mutation });
					}),
				);
			}),
		);
	});
	/** The identity of each of the user's relationships with these IDs; one the user lacks is absent. */
	const findUserRelationshipInputs = Effect.fn("RelationshipsService.findUserRelationshipInputs")(
		function* (userId: UserId, relationshipIds: ReadonlyArray<RelationshipId>) {
			const rows = yield* repository.findUserRelationshipsById(userId, relationshipIds);
			return new Map(
				[...rows].map(([relationshipId, row]) => [
					relationshipId,
					{
						userId,
						scope: "user" as const,
						...(row.key === undefined ? {} : { key: row.key }),
						sourceEntityId: row.sourceEntityId,
						targetEntityId: row.targetEntityId,
						relationshipSchema: {
							slug: row.relationshipSchemaSlug,
							owner: definitionOwner(row.relationshipSchemaPluginId),
						},
					} satisfies UserRelationshipInput,
				]),
			);
		},
	);
	/**
	 * Persists prepared user relationship writes as one set in the caller's transaction: their locked
	 * write checks, locks, lookup and endpoint reads once, one statement per operation, then each
	 * write's change recorded in `batch` in order. A write whose relationship changed since it was
	 * prepared conflicts; one without a request, or an ensure of a relationship that exists by then,
	 * writes nothing.
	 */
	const persistPrepared = Effect.fn("RelationshipsService.persistPrepared")(function* (
		transaction: WriteTransaction,
		tokens: ReadonlyArray<PreparedUserRelationship>,
		batch: { readonly command: DomainLifecycleCommand; readonly identity: ReadonlyArray<string> },
	) {
		yield* assertActiveTransaction;
		if (tokens.length === 0) {
			return { results: [], dispatch: [] };
		}
		const mutations = tokens.map(({ mutation }) => mutation);
		const pinOf = yield* primitives.verifyWrites(mutations.map(mutationWriteCheck), transaction);
		yield* primitives.lockMutations(mutations, transaction);
		const planned = zip(
			tokens,
			yield* primitives.planSources(
				tokens,
				yield* repository.findRelationships(mutations.map(({ input }) => input)),
			),
		);
		const written = planned.flatMap(([{ mutation }, source]) =>
			source.kind === "write" ? [mutation] : [],
		);
		const batchScope = { ...batch, resource: "relationship" as const };
		const batchId =
			written.length === 0
				? null
				: (yield* planner.prepareBatch(transaction, {
						...batchScope,
						scopes: [
							...new Set(
								written.map(({ input }) => (input.scope === "user" ? input.userId : null)),
							),
						],
					})).id;
		const reads = yield* primitives.readEntities(written);
		const schemas = yield* Effect.forEach(
			writtenSchemas(
				written.flatMap(({ mode, input }) =>
					input.scope !== "user" || mode === "delete"
						? []
						: [{ userId: input.userId, reference: relationshipSchemaReference(input) }],
				),
			),
			([userId, references]) =>
				Effect.map(
					definitions.findUserRelationshipSchemas(userId, references, transaction),
					(found) => [userId, found] as const,
				),
		).pipe(Effect.map((found) => new Map(found)));
		const sources = yield* Effect.forEach(planned, ([{ mutation }, source]) =>
			Effect.gen(function* () {
				if (source.kind !== "write") {
					return { source, mutation };
				}
				const validated = yield* primitives.validateMutation(
					mutation,
					reads,
					transaction,
					pinOf(mutation),
				);
				const reference = relationshipSchemaReference(mutation.input);
				const request = yield* primitives.revalidateRequest(
					mutation,
					source.request,
					validated,
					mutation.input.scope === "user"
						? schemas.get(mutation.input.userId)?.[
								definitionKey("relationship", reference.owner, reference.slug)
							]
						: undefined,
				);
				return { mutation, source: { ...source, request, validated } };
			}),
		);
		const persisted = zip(sources, yield* primitives.persistSources(transaction, sources));
		const dispatch: LifecycleDispatchPlan[] = [];
		const results: RelationshipWriteResult[] = [];
		for (const [index, [{ mutation }, { payload, ...result }]] of persisted.entries()) {
			const change =
				payload === null ? null : yield* primitives.planChange(transaction, { payload, mutation });
			yield* recordRelationshipImportItem(keys, mutation, result.operation);
			if (change !== null && batchId !== null) {
				dispatch.push(...change.dispatch);
				yield* planner.recordBatchChange(transaction, batchId, {
					index,
					payload: change.change,
					scopeUserId: mutation.input.scope === "user" ? mutation.input.userId : null,
				});
			}
			results.push(result);
		}
		return { results, dispatch };
	});
	return { persistPrepared, prepareUserChanges, findUserRelationshipInputs };
};
