import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationRelationshipDraft,
	type AutomationRelationshipSnapshot,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Cause, Effect, Schema } from "effect";

import {
	lifecycleTriggerId,
	type CommittedLifecycleWork,
	type LifecyclePlan,
} from "#lib/domain/lifecycle";
import { LifecycleCommand, lifecycleTrigger } from "#lib/domain/lifecycle-command";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	catalogDefinitionFingerprint,
	type CatalogDefinitionFingerprint,
} from "#modules/plugins/runtime-resolver";

import {
	activeTransactionGuard,
	assertRootTransaction,
	badProperties,
	equal,
	mergeProperties,
	parseProperties,
	populationIdentity,
	relationshipChange,
	snapshot,
	transaction,
	type CreateRelationshipInput,
	type Mutation,
	type RelationshipMutationDependencies,
	type RelationshipRequest,
} from "./mutation-support";
import type { RelationshipIdentityInput, RelationshipsRepository } from "./repository";

type PreparedUserRelationshipMutationData = {
	readonly command: LifecycleCommand;
	readonly input: RelationshipIdentityInput & { readonly scope: "user"; readonly userId: UserId };
	readonly request: RelationshipRequest;
	readonly requestId: LifecyclePlan["trigger"]["id"];
} & (
	| { readonly operation: "delete"; readonly before: AutomationRelationshipSnapshot }
	| ({ readonly operation: "create"; readonly before: AutomationRelationshipSnapshot | null } & (
			| {
					readonly committed?: never;
					readonly propertiesSchema: AppSchema;
					readonly schemaFingerprint: CatalogDefinitionFingerprint;
			  }
			| {
					readonly propertiesSchema?: never;
					readonly schemaFingerprint?: never;
					readonly committed: {
						readonly plan: LifecyclePlan;
						readonly relationship: Effect.Success<
							ReturnType<RelationshipsRepository["Service"]["createRelationship"]>
						>;
					};
			  }
	  ))
);
const preparedUserRelationshipCreate = Symbol("PreparedUserRelationshipCreate");
const preparedUserRelationshipDelete = Symbol("PreparedUserRelationshipDelete");
export type PreparedUserRelationshipCreate = {
	readonly [preparedUserRelationshipCreate]: Extract<
		PreparedUserRelationshipMutationData,
		{ operation: "create" }
	>;
};
export type PreparedUserRelationshipDelete = {
	readonly [preparedUserRelationshipDelete]: Extract<
		PreparedUserRelationshipMutationData,
		{ operation: "delete" }
	>;
};

/**
 * The prepared user-relationship surface. `prepare*` plans inside its own short transaction and
 * `persist*` writes inside the caller's active transaction, so the caller owns the commit and the
 * post-commit phase. Dependencies are passed in rather than resolved from context so each closure
 * keeps binding the exact instances the service layer was built with.
 */
export const makePreparedRelationshipMutations = ({
	client,
	planner,
	runtime,
	execution,
	repository,
}: RelationshipMutationDependencies) => {
	const assertActiveTransaction = activeTransactionGuard(client);
	const committedReplay = Effect.fnUntraced(function* (
		input: RelationshipIdentityInput,
		command: LifecycleCommand,
		mode: Exclude<Mutation["mode"], "delete">,
		properties: unknown,
	) {
		return yield* transaction(
			Effect.gen(function* () {
				if (input.scope === "user") {
					const entities = yield* EntitiesRepository;
					const [source, target] = yield* Effect.all([
						entities.getEntityScopeForUser({
							userId: input.userId,
							entityId: input.sourceEntityId,
						}),
						entities.getEntityScopeForUser({
							userId: input.userId,
							entityId: input.targetEntityId,
						}),
					]);
					if (!source || !target) {
						return yield* new RelationshipNotFound({
							reason: {
								code: "entity-not-found",
								entityIds: [input.sourceEntityId, input.targetEntityId],
							},
						});
					}
				}
				let request: RelationshipRequest | null = null;
				for (const operation of ["create", "update", "delete"] as const) {
					const payload = yield* repository.findLifecyclePayload(
						lifecycleTriggerId({
							discriminator: "lifecycle",
							itemIdentity: command.itemIdentity,
							executionId: command.causation.executionId,
							kind: { operation, category: "request", resource: "relationship" },
						}),
					);
					if (payload?.category === "request" && payload.resource === "relationship") {
						if (request) {
							return yield* new RelationshipBadRequest({
								reason: { code: "lifecycle-command-conflict" },
							});
						}
						request = payload;
					}
				}
				if (!request) {
					return null;
				}
				const before = request.operation === "update" ? request.before : null;
				const draft = yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
					sourceEntityId: input.sourceEntityId,
					targetEntityId: input.targetEntityId,
					relationshipSchemaSlug: input.relationshipSchemaSlug,
					properties:
						mode === "merge" ? mergeProperties(before?.properties, properties) : properties,
				}).pipe(Effect.mapError(() => badProperties([])));
				const supplied: RelationshipRequest = before
					? { draft, before, category: "request", operation: "update", resource: "relationship" }
					: { draft, category: "request", operation: "create", resource: "relationship" };
				if (!equal(request, supplied)) {
					return yield* new RelationshipBadRequest({
						reason: { code: "lifecycle-command-conflict" },
					});
				}
				const change = yield* repository.findLifecyclePayload(
					lifecycleTriggerId({
						discriminator: "lifecycle",
						itemIdentity: command.itemIdentity,
						executionId: command.causation.executionId,
						kind: { category: "change", resource: "relationship", operation: request.operation },
					}),
				);
				if (
					change?.category !== "change" ||
					change.resource !== "relationship" ||
					change.operation === "batch"
				) {
					return null;
				}
				const persisted = change.operation === "delete" ? change.before : change.after;
				const persistedDraft = {
					properties: persisted.properties,
					sourceEntityId: persisted.sourceEntityId,
					targetEntityId: persisted.targetEntityId,
					relationshipSchemaSlug: persisted.relationshipSchemaSlug,
				};
				if (
					change.operation !== request.operation ||
					!equal({ ...request.draft, properties: persisted.properties }, persistedDraft) ||
					(request.operation === "update" &&
						change.operation === "update" &&
						!equal(request.before, change.before)) ||
					!equal(populationIdentity(change.population), populationIdentity(command.population))
				) {
					return yield* new RelationshipBadRequest({
						reason: { code: "lifecycle-command-conflict" },
					});
				}
				const requestPlan = yield* planner.plan({
					trigger: lifecycleTrigger(command, input.scope === "user" ? input.userId : null, request),
				});
				const changePlan = yield* planner.plan({
					trigger: lifecycleTrigger(
						{
							...command,
							causation: { ...command.causation, parentTriggerId: requestPlan.trigger.id },
						},
						input.scope === "user" ? input.userId : null,
						change,
					),
				});
				if (requestPlan.wasCreated || changePlan.wasCreated) {
					return yield* new RelationshipBadRequest({
						reason: { code: "lifecycle-command-conflict" },
					});
				}
				return {
					request,
					requestPlan,
					plan: changePlan,
					relationship: { ...persisted, wasInserted: change.operation === "create" },
				};
			}),
		);
	});
	const prepareUserMutation = Effect.fnUntraced(function* (
		input: CreateRelationshipInput | RelationshipIdentityInput,
		commandInput: LifecycleCommand,
		mode: "create" | "delete",
	) {
		yield* assertRootTransaction;
		if (input.scope !== "user") {
			return yield* new DbError({ message: "Prepared relationship mutations require user scope" });
		}
		const command = yield* Schema.decodeEffect(LifecycleCommand)(commandInput).pipe(
			Effect.mapError(
				() => new RelationshipBadRequest({ reason: { code: "lifecycle-command-conflict" } }),
			),
		);
		if (mode === "create" && "properties" in input) {
			const replay = yield* committedReplay(input, command, "upsert", input.properties);
			if (replay) {
				return {
					input,
					command,
					request: replay.request,
					operation: "create" as const,
					requestId: replay.requestPlan.trigger.id,
					committed: { plan: replay.plan, relationship: replay.relationship },
					before: replay.request.operation === "update" ? replay.request.before : null,
				};
			}
		}
		let propertiesSchema: AppSchema | null = null;
		let initialProperties: Record<string, unknown> | null = null;
		let schemaFingerprint: CatalogDefinitionFingerprint | null = null;
		let authoritativeInput = input;
		if (mode === "create") {
			if (!("properties" in input)) {
				return yield* Effect.die("Prepared relationship create is missing properties");
			}
			const effective = yield* runtime.getEffectiveDefinitions(input.userId);
			const definition = effective.relationshipSchemas[input.relationshipSchemaSlug];
			if (!definition) {
				return yield* new RelationshipBadRequest({
					reason: { code: "concurrent-relationship-change" },
				});
			}
			const pluginId = definition.pluginId ?? null;
			if (
				input.relationshipSchemaPluginId !== undefined &&
				input.relationshipSchemaPluginId !== pluginId
			) {
				return yield* new RelationshipBadRequest({
					reason: { code: "concurrent-relationship-change" },
				});
			}
			authoritativeInput = { ...input, relationshipSchemaPluginId: pluginId };
			propertiesSchema = definition.propertiesSchema;
			schemaFingerprint = catalogDefinitionFingerprint(definition);
			initialProperties = yield* parseProperties(input.properties, propertiesSchema);
		}
		const planned = yield* transaction(
			Effect.gen(function* () {
				const entities = yield* EntitiesRepository;
				yield* entities.lockEntityReferencesByIds([
					authoritativeInput.sourceEntityId,
					authoritativeInput.targetEntityId,
				]);
				yield* repository.lockRelationshipMutations([authoritativeInput]);
				const row = yield* repository.findRelationship(authoritativeInput);
				const before = row ? yield* snapshot(row) : null;
				if (mode === "create" && before && equal(before.properties, initialProperties)) {
					return null;
				}
				let request: RelationshipRequest;
				if (mode === "delete") {
					if (!before) {
						return null;
					}
					request = {
						draft: before,
						category: "request",
						operation: "delete",
						resource: "relationship",
					};
				} else {
					const draft = yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
						properties: initialProperties,
						sourceEntityId: authoritativeInput.sourceEntityId,
						targetEntityId: authoritativeInput.targetEntityId,
						relationshipSchemaSlug: authoritativeInput.relationshipSchemaSlug,
					}).pipe(Effect.mapError(() => badProperties([])));
					request = before
						? { draft, before, category: "request", operation: "update", resource: "relationship" }
						: { draft, category: "request", operation: "create", resource: "relationship" };
				}
				const plan = yield* planner.plan({
					trigger: lifecycleTrigger(command, authoritativeInput.userId, request),
				});
				return { plan, before, command, request, input: authoritativeInput };
			}),
		);
		if (!planned) {
			return null;
		}
		if (planned.plan.trigger.blockedReason !== null) {
			return yield* new RelationshipBadRequest({ reason: { code: "automation-limit-reached" } });
		}
		// oxlint-disable-next-line no-accumulating-spread -- each policy must observe the previous policy's transformed draft
		let request = planned.request;
		yield* Effect.gen(function* () {
			for (const policy of planned.plan.policies) {
				const output = yield* execution
					.executePolicy({ payload: request, runId: policy.runId })
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
					if (
						output.payload.resource !== "relationship" ||
						output.payload.operation !== request.operation
					) {
						return yield* new RelationshipBadRequest({
							reason: { runId: policy.runId, code: "policy-rejected" },
						});
					}
					if (request.operation !== "delete") {
						request = {
							...request,
							draft: { ...request.draft, properties: output.payload.draft.properties },
						};
					}
				}
			}
			return undefined;
		}).pipe(
			Effect.catchCauseIf(
				(cause) => !Cause.hasInterruptsOnly(cause),
				(cause) =>
					execution
						.skipQueuedPolicies({ triggerId: planned.plan.trigger.id })
						.pipe(Effect.andThen(Effect.failCause(cause)), Effect.uninterruptible),
			),
		);
		if (request.operation !== "delete") {
			if (!propertiesSchema) {
				return yield* Effect.die("Prepared relationship create is missing its schema");
			}
			const properties = yield* parseProperties(request.draft.properties, propertiesSchema);
			request = {
				...request,
				draft: yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
					...request.draft,
					properties,
				}).pipe(Effect.mapError(() => badProperties([]))),
			};
		}
		if (mode === "create" && (!propertiesSchema || !schemaFingerprint)) {
			return yield* Effect.die("Prepared relationship create is missing schema metadata");
		}
		return {
			request,
			input: planned.input,
			before: planned.before,
			command: planned.command,
			requestId: planned.plan.trigger.id,
			...(mode === "create" && propertiesSchema && schemaFingerprint
				? { propertiesSchema, schemaFingerprint, operation: "create" as const }
				: { operation: "delete" as const }),
		};
	});
	const prepareUserCreate = Effect.fn("RelationshipsService.prepareUserCreate")(function* (
		input: CreateRelationshipInput,
		command: LifecycleCommand,
	) {
		const value = yield* prepareUserMutation(input, command, "create");
		if (value?.operation !== "create") {
			return null;
		}
		return Object.freeze({
			[preparedUserRelationshipCreate]: { ...value, operation: "create" as const },
		}) as PreparedUserRelationshipCreate;
	});
	const prepareUserDelete = Effect.fn("RelationshipsService.prepareUserDelete")(function* (
		input: RelationshipIdentityInput,
		command: LifecycleCommand,
	) {
		const value = yield* prepareUserMutation(input, command, "delete");
		if (value?.operation !== "delete" || !value.before) {
			return null;
		}
		return Object.freeze({
			[preparedUserRelationshipDelete]: {
				...value,
				before: value.before,
				operation: "delete" as const,
			},
		});
	});
	const persistPreparedUserMutation = Effect.fnUntraced(function* (
		prepared: PreparedUserRelationshipMutationData,
	) {
		yield* assertActiveTransaction;
		const entities = yield* EntitiesRepository;
		if (prepared.operation === "create" && prepared.committed) {
			return {
				plans: [prepared.committed.plan],
				result: prepared.committed.relationship,
			} satisfies CommittedLifecycleWork<typeof prepared.committed.relationship>;
		}
		let request = prepared.request;
		if (prepared.operation === "create") {
			if (request.operation === "delete") {
				return yield* Effect.die("Prepared relationship create has a delete request");
			}
			yield* runtime.lockCatalog();
			const effective = yield* runtime.getEffectiveDefinitions(prepared.input.userId);
			const definition = effective.relationshipSchemas[prepared.input.relationshipSchemaSlug];
			if (
				!definition ||
				(definition.pluginId ?? null) !== (prepared.input.relationshipSchemaPluginId ?? null) ||
				!equal(catalogDefinitionFingerprint(definition), prepared.schemaFingerprint)
			) {
				return yield* new RelationshipBadRequest({
					reason: { code: "concurrent-relationship-change" },
				});
			}
			const properties = yield* parseProperties(
				request.draft.properties,
				definition.propertiesSchema,
			);
			const draft = yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
				...request.draft,
				properties,
			}).pipe(Effect.mapError(() => badProperties([])));
			request = { ...request, draft };
		}
		yield* entities.lockEntityReferencesByIds([
			prepared.input.sourceEntityId,
			prepared.input.targetEntityId,
		]);
		yield* repository.lockRelationshipMutations([prepared.input]);
		let saved;
		if (prepared.operation === "delete") {
			saved = yield* repository.deletePreparedRelationship({
				...prepared.input,
				before: prepared.before,
			});
		} else if (request.operation === "create") {
			const created = yield* repository.createRelationship({
				...prepared.input,
				properties: { ...request.draft.properties },
			});
			saved = created.wasInserted ? created : null;
		} else {
			if (!prepared.before) {
				return yield* new RelationshipBadRequest({
					reason: { code: "concurrent-relationship-change" },
				});
			}
			saved = yield* repository.updatePreparedRelationship({
				...prepared.input,
				before: prepared.before,
				properties: { ...request.draft.properties },
			});
		}
		if (!saved) {
			return yield* new RelationshipBadRequest({
				reason: { code: "concurrent-relationship-change" },
			});
		}
		const persisted = yield* snapshot(saved);
		const plan = yield* planner.plan({
			trigger: lifecycleTrigger(
				{
					...prepared.command,
					causation: { ...prepared.command.causation, parentTriggerId: prepared.requestId },
				},
				prepared.input.userId,
				relationshipChange(request, persisted),
			),
		});
		return {
			plans: [plan],
			result: { ...saved, wasInserted: request.operation === "create" },
		} satisfies CommittedLifecycleWork<typeof saved & { wasInserted: boolean }>;
	});
	const persistPreparedUserCreate = Effect.fn("RelationshipsService.persistPreparedUserCreate")(
		function* (prepared: PreparedUserRelationshipCreate) {
			return yield* persistPreparedUserMutation(prepared[preparedUserRelationshipCreate]);
		},
	);
	const persistPreparedUserDelete = Effect.fn("RelationshipsService.persistPreparedUserDelete")(
		function* (prepared: PreparedUserRelationshipDelete) {
			return yield* persistPreparedUserMutation(prepared[preparedUserRelationshipDelete]);
		},
	);
	return {
		committedReplay,
		prepareUserCreate,
		prepareUserDelete,
		persistPreparedUserCreate,
		persistPreparedUserDelete,
	};
};
