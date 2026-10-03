import { DbError } from "@ryot-app/contract/errors";
import {
	type AutomationPolicyPatch,
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
import { Effect, Schema } from "effect";

import { makeManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import {
	toLifecycleDispatchPlan,
	type LifecyclePlannedPolicy,
} from "#modules/automations/lifecycle/planning";
import {
	applyLifecyclePolicyPatch,
	canonicalLifecyclePolicyPatch,
} from "#modules/automations/lifecycle/policy-patch";
import type { RelationshipSchemaDefinition } from "#modules/definitions/snapshot";
import type { MutationEntity } from "#modules/entities/repository";
import {
	assertStableUnder,
	type DomainLifecycleCommand,
	type DomainWriteCheck,
	type DomainWritePin,
	writerPropertiesSchema,
} from "#modules/entities/write-context";
import { MutationReceiptIdentityConflict } from "#modules/mutations/receipts";
import { catalogDefinitionFingerprint } from "#modules/plugins/catalog/runtime-resolver";

import {
	badProperties,
	equal,
	mergeProperties,
	parseProperties,
	relationshipChange,
	snapshot,
	relationshipSchemaReference,
	validateUserRelationshipEntities,
	type Mutation,
	type RelationshipMutationDependencies,
	relationshipWriteFailure,
	type UserEntityScopes,
} from "./mutation-support";
import { relationshipMutationLockKey } from "./repository";

export const classifyRelationshipReceiptConflict = (
	error: DbError | MutationReceiptIdentityConflict,
) =>
	error instanceof MutationReceiptIdentityConflict
		? new RelationshipBadRequest({ reason: { code: "lifecycle-command-conflict" } })
		: error;

export type ValidatedMutation = {
	readonly active: RelationshipSchemaDefinition;
	readonly pinned: RelationshipSchemaDefinition;
};

export type MutationEntities = {
	readonly users: ReadonlyMap<UserId, UserEntityScopes>;
	readonly global: ReadonlyMap<EntityId, MutationEntity>;
};

export const mutationWriteCheck = (
	mutation: Pick<Mutation, "command" | "input">,
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
	source: AutomationRelationshipSnapshot | null,
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
	execution,
	repository,
	definitions,
}: RelationshipMutationDependencies) => {
	const lockAssetReferences = makeManagedAssetReferenceLocker(session);
	const assertActiveTransaction = session.requireTransaction.pipe(
		Effect.mapError(
			() =>
				new DbError({ message: "Relationship mutation primitives require an active transaction" }),
		),
	);
	const verifyWrites = Effect.fnUntraced(function* (checks: ReadonlyArray<DomainWriteCheck>) {
		const pinOf = yield* writes.checkMany(checks).pipe(Effect.mapError(relationshipWriteFailure));
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
		verified?: DomainWritePin | null,
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
		const pin =
			verified === undefined
				? yield* writes
						.check(
							mutation.command,
							reference.owner,
							mutation.input.scope === "user" ? mutation.input.userId : null,
							true,
						)
						.pipe(Effect.mapError(relationshipWriteFailure))
				: verified;
		const { pinned: declared, active: activeDeclaration } = yield* writes.resolvePinnedDeclaration(
			"relationship",
			pin,
			reference.owner,
			reference.slug,
		);
		let active: RelationshipSchemaDefinition | null = activeDeclaration
			? { ...activeDeclaration, pluginId: mutation.input.relationshipSchemaPluginId }
			: null;
		if (!activeDeclaration) {
			if (mutation.input.scope === "user") {
				active =
					(yield* definitions.findUserRelationshipSchemas(mutation.input.userId, [reference]))[
						definitionKey("relationship", reference.owner, reference.slug)
					] ?? null;
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
		if (mutation.input.scope === "user") {
			yield* validateUserRelationshipEntities(
				reads.users.get(mutation.input.userId) ?? new Map(),
				mutation.input,
				pinned,
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
		before: AutomationRelationshipSnapshot | null,
		validated: ValidatedMutation,
	) {
		yield* assertActiveTransaction;
		yield* assertStableSource(mutation, validated, before);
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
		const value = yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
			sourceEntityId: mutation.input.sourceEntityId,
			targetEntityId: mutation.input.targetEntityId,
			relationshipSchemaSlug: mutation.input.relationshipSchemaSlug,
			relationshipSchemaPluginId: mutation.input.relationshipSchemaPluginId,
			properties: yield* parseProperties(
				properties,
				validated.pinned.propertiesSchema,
				Boolean(mutation.command.writeContext?.pluginRevision),
			),
		}).pipe(Effect.mapError(() => badProperties([])));
		if (before && equal(before.properties, value.properties)) {
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
	const applyPolicies = Effect.fnUntraced(function* (
		initial: AutomationRelationshipRequestPayload,
		policies: ReadonlyArray<LifecyclePlannedPolicy>,
		mutation: Mutation,
	) {
		let request = initial;
		const acceptedPatches: AutomationPolicyPatch[] = [];
		for (const policy of policies) {
			const output = yield* execution
				.executePolicy({ runId: policy.runId, acceptedPatches: [...acceptedPatches] })
				.pipe(
					Effect.catchTag("AutomationPolicyExecutionError", (error) =>
						Effect.fail(
							new RelationshipBadRequest({
								reason: { runId: error.runId, code: "policy-execution-failed" },
							}),
						),
					),
				);
			if (output.action === "reject") {
				return yield* new RelationshipBadRequest({
					reason: { runId: policy.runId, code: "policy-rejected" },
				});
			}
			if (output.action === "transform") {
				const patched = applyLifecyclePolicyPatch(request, output.patch);
				if (!patched.ok || patched.request.operation === "delete") {
					return yield* new RelationshipBadRequest({
						reason: { runId: policy.runId, code: "policy-rejected" },
					});
				}
				if (!mutation.propertiesSchema) {
					return yield* new DbError({ message: "Missing relationship property schema" });
				}
				const properties = yield* parseProperties(
					patched.request.draft.properties,
					mutation.propertiesSchema,
				);
				const successor = { ...patched.request, draft: yield* draft(patched.request, properties) };
				const accepted = canonicalLifecyclePolicyPatch(request, successor);
				request = successor;
				if (accepted) {
					acceptedPatches.push(accepted);
				}
			}
		}
		if (request.operation !== "delete") {
			if (!mutation.propertiesSchema) {
				return yield* new DbError({ message: "Missing relationship property schema" });
			}
			const properties = yield* parseProperties(
				request.draft.properties,
				mutation.propertiesSchema,
			);
			request = { ...request, draft: yield* draft(request, properties) };
		}
		return request;
	});
	const revalidateRequest = Effect.fnUntraced(function* (
		mutation: Mutation,
		request: AutomationRelationshipRequestPayload,
		validated: ValidatedMutation,
		resolved?: { definition: RelationshipSchemaDefinition | null | undefined },
	) {
		yield* assertActiveTransaction;
		if (request.operation === "delete") {
			return request;
		}
		let definition: RelationshipSchemaDefinition | null | undefined;
		if (resolved) {
			definition = resolved.definition;
		} else if (mutation.input.scope === "user") {
			const reference = relationshipSchemaReference(mutation.input);
			definition = (yield* definitions.findUserRelationshipSchemas(mutation.input.userId, [
				reference,
			]))[definitionKey("relationship", reference.owner, reference.slug)];
		} else {
			definition = yield* definitions.findGlobalRelationshipSchema(
				relationshipSchemaReference(mutation.input),
			);
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
		return { ...request, draft: yield* draft(request, properties) };
	});
	const persistSources = Effect.fnUntraced(function* (
		items: ReadonlyArray<{
			readonly mutation: Mutation;
			readonly validated: ValidatedMutation;
			readonly before: AutomationRelationshipSnapshot | null;
			readonly request: AutomationRelationshipRequestPayload | null;
		}>,
	) {
		yield* assertActiveTransaction;
		const rows = yield* repository.findRelationships(items.map(({ mutation }) => mutation.input));
		const written = new Set<string>();
		const decisions = [];
		for (const { before, request, mutation, validated } of items) {
			const key = relationshipMutationLockKey(mutation.input);
			// An earlier item of this batch already changed the row this item planned against.
			if (written.has(key)) {
				return yield* concurrentChange();
			}
			const row = rows.get(key) ?? null;
			const current = row ? yield* snapshot(row) : null;
			yield* assertStableSource(mutation, validated, current);
			const alreadyEnsured = mutation.mode === "ensure" && current !== null;
			if (!alreadyEnsured && !equal(current, before)) {
				return yield* concurrentChange();
			}
			if (
				alreadyEnsured ||
				!request ||
				(request.operation !== "delete" &&
					current &&
					equal(current.properties, request.draft.properties))
			) {
				decisions.push({
					key,
					row,
					request: null,
					input: mutation.input,
					propertiesSchema: validated.active.propertiesSchema,
				});
				continue;
			}
			written.add(key);
			decisions.push({
				key,
				row,
				request,
				input: mutation.input,
				propertiesSchema: validated.active.propertiesSchema,
			});
		}
		const assetRecords = decisions.flatMap(({ input, request, propertiesSchema }) =>
			request && request.operation !== "delete"
				? [
						{
							propertiesSchema,
							properties: request.draft.properties,
							ownerUserId: input.scope === "user" ? input.userId : null,
						},
					]
				: [],
		);
		yield* lockAssetReferences(assetRecords).pipe(
			Effect.catchTag("ManagedAssetReferenceRejected", assetForbidden),
		);
		const deleted = yield* repository.deleteRelationshipsById(
			decisions.flatMap(({ row, request }) =>
				request?.operation === "delete" && row ? [row.id] : [],
			),
		);
		const updated = yield* repository.updateRelationshipsById(
			decisions.flatMap(({ row, request }) =>
				request?.operation === "update" && row
					? [{ id: row.id, properties: { ...request.draft.properties } }]
					: [],
			),
		);
		const created = yield* repository.createRelationships(
			decisions.flatMap(({ input, request }) =>
				request?.operation === "create"
					? [{ ...input, properties: { ...request.draft.properties } }]
					: [],
			),
		);
		return yield* Effect.forEach(
			decisions,
			Effect.fnUntraced(function* ({ key, row, request }) {
				if (!request) {
					return {
						payload: null,
						operation: "noop" as const,
						relationship: row ? { ...row, wasInserted: false } : null,
					};
				}
				let saved;
				if (request.operation === "create") {
					saved = created.get(key);
				} else if (row) {
					saved = (request.operation === "delete" ? deleted : updated).get(row.id);
				}
				if (!saved) {
					return yield* new RelationshipNotFound({ reason: { code: "relationship-not-found" } });
				}
				return {
					operation: request.operation,
					payload: relationshipChange(request, yield* snapshot(saved)),
					relationship: { ...saved, wasInserted: request.operation === "create" },
				};
			}),
		);
	});
	const persistPreparedSource = Effect.fnUntraced(function* (
		mutation: Mutation,
		request: AutomationRelationshipRequestPayload,
		before: AutomationRelationshipSnapshot | null,
		validated: ValidatedMutation,
	) {
		yield* assertActiveTransaction;
		yield* assertStableSource(mutation, validated, before);
		if (request.operation !== "delete") {
			yield* lockAssetReferences([
				{
					properties: request.draft.properties,
					propertiesSchema: validated.active.propertiesSchema,
					ownerUserId: mutation.input.scope === "user" ? mutation.input.userId : null,
				},
			]).pipe(Effect.catchTag("ManagedAssetReferenceRejected", assetForbidden));
		}
		if (request.operation === "create") {
			const saved = yield* repository.createRelationship({
				...mutation.input,
				properties: { ...request.draft.properties },
			});
			if (!saved.wasInserted) {
				return yield* concurrentChange();
			}
			return {
				operation: request.operation,
				relationship: { ...saved, wasInserted: true },
				payload: relationshipChange(request, yield* snapshot(saved)),
			};
		}
		if (!before) {
			return yield* concurrentChange();
		}
		const saved = yield* request.operation === "delete"
			? repository.deletePreparedRelationship({ ...mutation.input, before })
			: repository.updatePreparedRelationship({
					...mutation.input,
					before,
					properties: { ...request.draft.properties },
				});
		if (!saved) {
			return yield* concurrentChange();
		}
		return {
			operation: request.operation,
			relationship: { ...saved, wasInserted: false },
			payload: relationshipChange(request, yield* snapshot(saved)),
		};
	});
	const planChange = Effect.fnUntraced(function* (input: {
		mutation: Mutation;
		requestId: DomainLifecycleCommand["causation"]["parentTriggerId"];
		payload: ReturnType<typeof relationshipChange>;
		population?: DomainLifecycleCommand["population"];
	}) {
		yield* assertActiveTransaction;
		const { command } = input.mutation;
		const change = {
			...input.payload,
			...(input.population === undefined ? {} : { population: input.population }),
		};
		const plan = yield* planner.plan({
			trigger: lifecycleTrigger(
				{
					...command,
					causation: {
						...command.causation,
						parentTriggerId: input.requestId ?? command.causation.parentTriggerId,
					},
				},
				input.mutation.input.scope === "user" ? input.mutation.input.userId : null,
				change,
			),
		});
		return { change, dispatch: plan.trigger === null ? [] : [toLifecycleDispatchPlan(plan)] };
	});
	const lockMutations = Effect.fnUntraced(function* (mutations: ReadonlyArray<Mutation>) {
		yield* assertActiveTransaction;
		yield* entities.lockEntityReferencesByIds(
			mutations.flatMap(({ input }) => [input.sourceEntityId, input.targetEntityId]),
		);
		yield* repository.lockRelationshipMutations(mutations.map(({ input }) => input));
		yield* runtime.lockCatalog();
	});
	return {
		planChange,
		readEntities,
		verifyWrites,
		applyPolicies,
		lockMutations,
		persistSources,
		prepareRequest,
		validateMutation,
		revalidateRequest,
		persistPreparedSource,
	};
};

export const relationshipPopulation = (
	command: DomainLifecycleCommand,
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
				...(command.population.batch
					? {
							batch: {
								...command.population.batch,
								...counts,
								isLeader,
								beforeCount,
								afterCount: beforeCount + counts.createdCount - counts.deletedCount,
							},
						}
					: {}),
			}
		: undefined;
