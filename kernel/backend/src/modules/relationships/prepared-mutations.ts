import { DbError } from "@ryot-app/contract/errors";
import type {
	AutomationRelationshipRequestPayload,
	AutomationRelationshipSnapshot,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import type { EntityId, RelationshipId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";

import {
	applyPolicyChunks,
	invalidPolicyItemReason,
	matchPolicyChunks,
	type PolicyBatchResult,
	subjectChunks,
} from "#modules/automations/lifecycle/policies";
import {
	type PreparedEntityCreate,
	preparedEntityCreateData,
} from "#modules/entities/prepared-entity-create";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import { catalogDefinitionFingerprint } from "#modules/plugins/catalog/runtime-resolver";

import {
	makeRelationshipMutationPrimitives,
	type MutationEntities,
	mutationWriteCheck,
} from "./mutation-primitives";
import {
	activeTransactionGuard,
	equal,
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
];

const concurrentChange = () =>
	new RelationshipBadRequest({ reason: { code: "concurrent-relationship-change" } });

const schemaKey = (mutation: Mutation) => {
	const reference = relationshipSchemaReference(mutation.input);
	return definitionKey("relationship", reference.owner, reference.slug);
};

/** Matches the policies of every prepared write with a request, in the caller's transaction. */
export const matchRelationshipPolicies = (input: {
	readonly userId: UserId;
	readonly command: DomainLifecycleCommand;
	readonly prepared: ReadonlyArray<PreparedUserRelationship>;
}) => {
	const requested = input.prepared.flatMap((token): ReadonlyArray<RequestedRelationship> => {
		const { request, mutation } = token;
		return request === null ? [] : [{ token, request, mutation }];
	});
	return matchPolicyChunks(
		subjectChunks(requested, (item) => item.mutation.input.sourceEntityId),
		(items, index) =>
			Effect.succeed({
				references: {},
				userId: input.userId,
				resource: "relationship" as const,
				command: {
					...input.command,
					itemIdentity: `${input.command.itemIdentity}:relationship-policies:${index}`,
				},
				items: items.map(({ request, mutation }) => ({
					request,
					schemaKey: schemaKey(mutation),
					itemIdentity: mutation.command.itemIdentity,
				})),
				propertiesSchemas: Object.fromEntries(
					items.flatMap(({ mutation }) =>
						mutation.propertiesSchema ? [[schemaKey(mutation), mutation.propertiesSchema]] : [],
					),
				),
			}),
	);
};

/** Runs the matched relationship policies, outside any transaction. */
export const applyRelationshipPolicies = (
	chunks: Effect.Success<ReturnType<typeof matchRelationshipPolicies>>,
) =>
	applyPolicyChunks(chunks).pipe(
		Effect.catchTag("AutomationPolicyExecutionError", (error) =>
			Effect.fail(
				new RelationshipBadRequest({
					reason: { runId: error.runId, code: "policy-execution-failed" },
				}),
			),
		),
	);

/**
 * Each prepared write with its policy decision applied; a rejected or invalid item fails. A write
 * without a request, or outside the decided chunks, stands as prepared.
 */
export const acceptRelationshipPolicies = (
	chunks: Effect.Success<ReturnType<typeof applyRelationshipPolicies>>,
) => {
	const decided = new Map<PreparedUserRelationship, PolicyBatchResult["items"][number]>();
	for (const chunk of chunks) {
		for (const [index, item] of chunk.items.entries()) {
			const decision = chunk.validated.items[index];
			if (decision) {
				decided.set(item.token, decision);
			}
		}
	}
	return Effect.fnUntraced(function* (token: PreparedUserRelationship) {
		const decision = decided.get(token);
		if (!decision) {
			return token;
		}
		if (decision.rejected !== null) {
			return yield* new RelationshipBadRequest({
				reason: { code: "policy-rejected", message: decision.rejected },
			});
		}
		if (decision.error !== null) {
			return yield* new RelationshipBadRequest({ reason: invalidPolicyItemReason(decision.error) });
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
const withCreatedEndpoint = (
	reads: MutationEntities,
	mutation: Mutation,
	createdEntity: undefined | PreparedEntityCreate,
): MutationEntities => {
	if (!createdEntity || mutation.input.scope !== "user") {
		return reads;
	}
	const created = preparedEntityCreateData(createdEntity);
	if (
		(created.entityId !== mutation.input.sourceEntityId &&
			created.entityId !== mutation.input.targetEntityId) ||
		created.userId !== mutation.input.userId
	) {
		return reads;
	}
	const scopes = new Map(reads.users.get(created.userId));
	scopes.set(created.entityId, {
		entityName: "",
		entityId: created.entityId,
		entityUserId: created.userId,
		entitySchemaSlug: created.entitySchemaSlug,
		isBuiltin: created.entitySchemaPluginId === null,
		entitySchemaPluginId: created.entitySchemaPluginId,
	});
	return { ...reads, users: new Map(reads.users).set(created.userId, scopes) };
};

/**
 * User relationship writes prepared outside the commit. Their caller runs their policies once per
 * batch, matching them in its prepare transaction, applying them outside it, and accepting each item's
 * decision before persisting it in its commit transaction, whose resource batches it seals.
 */
export const makePreparedRelationshipMutations = (
	dependencies: RelationshipMutationDependencies,
) => {
	const { keys, writes, session, planner, repository, definitions } = dependencies;
	const primitives = makeRelationshipMutationPrimitives(dependencies);
	const transaction = rootTransaction(session);
	const assertRootTransaction = rootTransactionGuard(session);
	const assertActiveTransaction = activeTransactionGuard(session);
	const prepareUserMutation = Effect.fnUntraced(function* (
		submitted: UserRelationshipInput | UserRelationshipWrite,
		commandInput: DomainLifecycleCommand,
		mode: "delete" | UserRelationshipMode,
		createdEntity?: PreparedEntityCreate,
	) {
		yield* assertRootTransaction;
		const input = relationshipIdentity(submitted);
		if (input.scope !== "user") {
			return yield* new DbError({ message: "Prepared relationship mutations require user scope" });
		}
		const command = yield* Schema.decodeEffect(DomainLifecycleCommand)(commandInput).pipe(
			Effect.mapError(
				() => new RelationshipBadRequest({ reason: { code: "lifecycle-command-conflict" } }),
			),
		);
		yield* writes
			.check(command, relationshipSchemaReference(input).owner, input.userId)
			.pipe(Effect.mapError(relationshipWriteFailure));
		let mutation: Mutation = { mode, input, command };
		if (mode !== "delete") {
			if (!("properties" in submitted)) {
				return yield* Effect.die("A prepared relationship write is missing properties");
			}
			const reference = relationshipSchemaReference(input);
			const definition = (yield* definitions.findUserRelationshipSchemas(input.userId, [
				reference,
			]))[definitionKey("relationship", reference.owner, reference.slug)];
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
			mutation = {
				...mutation,
				properties: submitted.properties,
				propertiesSchema: definition.propertiesSchema,
				schemaFingerprint: catalogDefinitionFingerprint(definition),
				input: { ...input, relationshipSchemaPluginId: definition.pluginId ?? null },
			};
		}
		return yield* transaction(
			Effect.gen(function* () {
				const pinOf = yield* primitives.verifyWrites([mutationWriteCheck(mutation)]);
				yield* primitives.lockMutations([mutation]);
				const validated = yield* primitives.validateMutation(
					mutation,
					withCreatedEndpoint(yield* primitives.readEntities([mutation]), mutation, createdEntity),
					pinOf(mutation),
				);
				const row = yield* repository.findRelationship(mutation.input);
				const before = row ? yield* snapshot(row) : null;
				const request = yield* primitives.prepareRequest(mutation, before, validated);
				return prepared({ before, request, mutation });
			}),
		);
	});
	const prepareUserWrite = Effect.fn("RelationshipsService.prepareUserWrite")(
		(
			input: UserRelationshipWrite,
			command: DomainLifecycleCommand,
			mode: UserRelationshipMode,
			createdEntity?: PreparedEntityCreate,
		) => prepareUserMutation(input, command, mode, createdEntity),
	);
	const prepareUserDelete = Effect.fn("RelationshipsService.prepareUserDelete")(
		(input: UserRelationshipInput, command: DomainLifecycleCommand) =>
			prepareUserMutation(input, command, "delete"),
	);
	/** Prepares deleting the user's relationship by ID; null when the user has no such relationship. */
	const prepareUserDeleteById = Effect.fn("RelationshipsService.prepareUserDeleteById")(function* (
		userId: UserId,
		relationshipId: RelationshipId,
		command: DomainLifecycleCommand,
	) {
		const row = yield* repository.findUserRelationshipById(userId, relationshipId);
		if (!row) {
			return null;
		}
		return yield* prepareUserMutation(
			{
				userId,
				scope: "user",
				sourceEntityId: row.sourceEntityId,
				targetEntityId: row.targetEntityId,
				relationshipSchema: {
					slug: row.relationshipSchemaSlug,
					owner: definitionOwner(row.relationshipSchemaPluginId),
				},
			},
			command,
			"delete",
		);
	});
	const persistPrepared = Effect.fn("RelationshipsService.persistPrepared")(function* (
		token: PreparedUserRelationship,
		batchInput?: {
			index: number;
			command: DomainLifecycleCommand;
			identity: ReadonlyArray<string>;
		},
	) {
		yield* assertActiveTransaction;
		const { before, request, mutation } = token;
		const pinOf = yield* primitives.verifyWrites([mutationWriteCheck(mutation)]);
		yield* primitives.lockMutations([mutation]);
		// An ensure stands when its relationship exists by commit, including one written since it was prepared.
		if (request === null || mutation.mode === "ensure") {
			const row = yield* repository.findRelationship(mutation.input);
			const current = row ? yield* snapshot(row) : null;
			const ensured = mutation.mode === "ensure" && current !== null;
			if (request === null || ensured) {
				if (!ensured && !equal(current, before)) {
					return yield* concurrentChange();
				}
				yield* recordRelationshipImportItem(keys, mutation, "noop");
				const result: RelationshipWriteResult = {
					operation: "noop",
					relationship: row ? { ...row, wasInserted: false } : null,
				};
				return { result, dispatch: [] };
			}
		}
		const batchScope = {
			resource: "relationship" as const,
			command: batchInput?.command ?? mutation.command,
			identity: batchInput?.identity ?? [mutation.command.itemIdentity],
		};
		const batch = yield* planner.prepareBatch({
			...batchScope,
			scopes: [mutation.input.scope === "user" ? mutation.input.userId : null],
		});
		const validated = yield* primitives.validateMutation(
			mutation,
			yield* primitives.readEntities([mutation]),
			pinOf(mutation),
		);
		const revalidated = yield* primitives.revalidateRequest(mutation, request, validated);
		const { payload, ...persisted } = yield* primitives.persistPreparedSource(
			mutation,
			revalidated,
			before,
			validated,
		);
		const { change, dispatch } = yield* primitives.planChange({ payload, mutation });
		yield* recordRelationshipImportItem(keys, mutation, persisted.operation);
		yield* planner.recordBatchChange(batch.id, {
			payload: change,
			index: batchInput?.index ?? 0,
			scopeUserId: mutation.input.scope === "user" ? mutation.input.userId : null,
		});
		const result: RelationshipWriteResult = persisted;
		return { result, dispatch };
	});
	return { persistPrepared, prepareUserWrite, prepareUserDelete, prepareUserDeleteById };
};
