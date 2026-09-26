import { DbError } from "@ryot-app/contract/errors";
import {
	type AutomationPolicyPatch,
	AutomationRelationshipDraft,
	type AutomationRelationshipRequestPayload,
	type AutomationRelationshipSnapshot,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Cause, Effect, Schema } from "effect";

import {
	toLifecycleDispatchPlan,
	type CommittedLifecycleWork,
	type LifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import { LifecycleCommand, lifecycleTrigger } from "#lib/domain/lifecycle-command";
import {
	applyLifecyclePolicyPatch,
	canonicalLifecyclePolicyPatch,
} from "#lib/domain/lifecycle-policy-patch";
import type { MutationReceiptIdentity } from "#modules/mutations/receipts";
import { MutationReceiptIdentityConflict } from "#modules/mutations/receipts";
import {
	catalogDefinitionFingerprint,
	type CatalogDefinitionFingerprint,
} from "#modules/plugins/runtime-resolver";

import {
	activeTransactionGuard,
	badProperties,
	equal,
	parseProperties,
	relationshipChange,
	relationshipReceiptIdentity,
	RelationshipRecordedResult,
	rootTransaction,
	rootTransactionGuard,
	snapshot,
	type CreateRelationshipInput,
	type Mutation,
	type RelationshipMutationDependencies,
} from "./mutation-support";
import type { RelationshipIdentityInput, RelationshipsRepository } from "./repository";

type PreparedRelationshipBase = {
	readonly command: LifecycleCommand;
	readonly input: RelationshipIdentityInput & { readonly scope: "user"; readonly userId: UserId };
	readonly receipt: MutationReceiptIdentity;
};
type CommittedRelationship = {
	readonly dispatch: ReadonlyArray<LifecycleDispatchPlan>;
	readonly relationship: Effect.Success<
		ReturnType<RelationshipsRepository["Service"]["createRelationship"]>
	>;
};
type PreparedUserRelationshipMutationData = PreparedRelationshipBase &
	(
		| {
				readonly operation: "delete";
				readonly committed: CommittedRelationship;
				readonly request?: never;
				readonly before?: never;
				readonly requestId?: never;
		  }
		| {
				readonly operation: "delete";
				readonly committed?: never;
				readonly request: AutomationRelationshipRequestPayload;
				readonly before: AutomationRelationshipSnapshot;
				readonly requestId: LifecycleCommand["causation"]["parentTriggerId"];
		  }
		| {
				readonly operation: "create";
				readonly committed: CommittedRelationship;
				readonly request?: never;
				readonly before?: never;
				readonly requestId?: never;
				readonly propertiesSchema?: never;
				readonly schemaFingerprint?: never;
		  }
		| {
				readonly operation: "create";
				readonly committed?: never;
				readonly request: AutomationRelationshipRequestPayload;
				readonly before: AutomationRelationshipSnapshot | null;
				readonly requestId: LifecycleCommand["causation"]["parentTriggerId"];
				readonly propertiesSchema: AppSchema;
				readonly schemaFingerprint: CatalogDefinitionFingerprint;
		  }
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
	session,
	planner,
	runtime,
	entities,
	receipts,
	execution,
	repository,
	definitions,
}: RelationshipMutationDependencies) => {
	const transaction = rootTransaction(session);
	const assertRootTransaction = rootTransactionGuard(session);
	const assertActiveTransaction = activeTransactionGuard(session);
	const committedReplay = Effect.fnUntraced(function* (
		input: RelationshipIdentityInput,
		command: LifecycleCommand,
		mode: Mutation["mode"],
		properties: unknown,
	) {
		const receipt = relationshipReceiptIdentity({ mode, input, command, properties });
		return yield* receipts
			.peek(receipt, RelationshipRecordedResult)
			.pipe(
				Effect.mapError((error) =>
					error instanceof MutationReceiptIdentityConflict
						? new RelationshipBadRequest({ reason: { code: "lifecycle-command-conflict" } })
						: error,
				),
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
		const receiptMode = mode === "create" ? "upsert" : "delete";
		const receiptProperties = "properties" in input ? input.properties : undefined;
		const receipt = relationshipReceiptIdentity({
			input,
			command,
			mode: receiptMode,
			properties: receiptProperties,
		});
		const replay = yield* committedReplay(input, command, receiptMode, receiptProperties);
		if (replay) {
			if (!replay.result.relationship) {
				return yield* new DbError({ message: "Committed relationship is missing its result" });
			}
			const committed = { dispatch: replay.dispatch, relationship: replay.result.relationship };
			return mode === "create"
				? ({
						input,
						command,
						receipt,
						committed,
						operation: "create" as const,
					} satisfies PreparedUserRelationshipMutationData)
				: ({
						input,
						command,
						receipt,
						committed,
						operation: "delete" as const,
					} satisfies PreparedUserRelationshipMutationData);
		}
		let propertiesSchema: AppSchema | null = null;
		let initialProperties: Record<string, unknown> | null = null;
		let schemaFingerprint: CatalogDefinitionFingerprint | null = null;
		let authoritativeInput = input;
		if (mode === "create") {
			if (!("properties" in input)) {
				return yield* Effect.die("Prepared relationship create is missing properties");
			}
			const definition = (yield* definitions.findUserRelationshipSchemas(input.userId, [
				input.relationshipSchemaSlug,
			]))[input.relationshipSchemaSlug];
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
				let request: AutomationRelationshipRequestPayload;
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
		if (planned.plan.trigger?.blockedReason) {
			return yield* new RelationshipBadRequest({ reason: { code: "automation-limit-reached" } });
		}
		let request = planned.request;
		const acceptedPatches: AutomationPolicyPatch[] = [];
		yield* Effect.gen(function* () {
			for (const policy of planned.plan.policies) {
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
					if (!propertiesSchema) {
						return yield* Effect.die("Prepared relationship mutation is missing its schema");
					}
					const properties = yield* parseProperties(
						patched.request.draft.properties,
						propertiesSchema,
					);
					const successor = {
						...patched.request,
						draft: yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
							...patched.request.draft,
							properties,
						}).pipe(Effect.mapError(() => badProperties([]))),
					};
					const acceptedPatch = canonicalLifecyclePolicyPatch(request, successor);
					request = successor;
					if (acceptedPatch) {
						acceptedPatches.push(acceptedPatch);
					}
				}
			}
			return undefined;
		}).pipe(
			Effect.catchCauseIf(
				(cause) => !Cause.hasInterruptsOnly(cause),
				(cause) =>
					planned.plan.trigger === null
						? Effect.failCause(cause)
						: execution
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
		const common = {
			receipt,
			request,
			input: planned.input,
			before: planned.before,
			command: planned.command,
			requestId: planned.plan.trigger?.id ?? null,
		};
		if (mode === "create") {
			if (!propertiesSchema || !schemaFingerprint) {
				return yield* Effect.die("Prepared relationship create is missing schema metadata");
			}
			return {
				...common,
				propertiesSchema,
				schemaFingerprint,
				operation: "create" as const,
			} satisfies PreparedUserRelationshipMutationData;
		}
		if (!planned.before) {
			return yield* Effect.die("Prepared relationship delete is missing its snapshot");
		}
		return {
			...common,
			before: planned.before,
			operation: "delete" as const,
		} satisfies PreparedUserRelationshipMutationData;
	});
	const prepareUserCreate = Effect.fn("RelationshipsService.prepareUserCreate")(function* (
		input: CreateRelationshipInput,
		command: LifecycleCommand,
	) {
		const value = yield* prepareUserMutation(input, command, "create");
		if (value?.operation !== "create") {
			return null;
		}
		const prepared: PreparedUserRelationshipCreate = Object.freeze({
			[preparedUserRelationshipCreate]: value,
		});
		return prepared;
	});
	const prepareUserDelete = Effect.fn("RelationshipsService.prepareUserDelete")(function* (
		input: RelationshipIdentityInput,
		command: LifecycleCommand,
	) {
		const value = yield* prepareUserMutation(input, command, "delete");
		if (value?.operation !== "delete") {
			return null;
		}
		return Object.freeze({ [preparedUserRelationshipDelete]: value });
	});
	const persistPreparedUserMutation = Effect.fnUntraced(function* (
		prepared: PreparedUserRelationshipMutationData,
		batchInput?: { command: LifecycleCommand; identity: ReadonlyArray<string>; index: number },
	) {
		yield* assertActiveTransaction;
		if (prepared.committed) {
			return {
				dispatch: prepared.committed.dispatch,
				result: prepared.committed.relationship,
			} satisfies CommittedLifecycleWork<typeof prepared.committed.relationship>;
		}
		const replay = yield* receipts
			.lookup(prepared.receipt, RelationshipRecordedResult)
			.pipe(
				Effect.mapError((error) =>
					error instanceof MutationReceiptIdentityConflict
						? new RelationshipBadRequest({ reason: { code: "lifecycle-command-conflict" } })
						: error,
				),
			);
		if (replay) {
			if (!replay.result.relationship) {
				return yield* new DbError({ message: "Committed relationship is missing its result" });
			}
			return { dispatch: replay.dispatch, result: replay.result.relationship };
		}
		const batchScope = {
			resource: "relationship" as const,
			command: batchInput?.command ?? prepared.command,
			identity: batchInput?.identity ?? [prepared.command.itemIdentity],
		};
		const batch = yield* planner.prepareBatch({ ...batchScope, scopes: [prepared.input.userId] });
		let request = prepared.request;
		if (prepared.operation === "create") {
			if (request.operation === "delete") {
				return yield* Effect.die("Prepared relationship create has a delete request");
			}
			yield* runtime.lockCatalog();
			const definition = (yield* definitions.findUserRelationshipSchemas(prepared.input.userId, [
				prepared.input.relationshipSchemaSlug,
			]))[prepared.input.relationshipSchemaSlug];
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
					causation: {
						...prepared.command.causation,
						parentTriggerId: prepared.requestId ?? prepared.command.causation.parentTriggerId,
					},
				},
				prepared.input.userId,
				relationshipChange(request, persisted),
			),
		});
		const dispatch = plan.trigger === null ? [] : [toLifecycleDispatchPlan(plan)];
		const result = { ...saved, wasInserted: request.operation === "create" };
		yield* receipts.insert({
			dispatch,
			batchId: batch.id,
			identity: prepared.receipt,
			batchIndex: batchInput?.index ?? 0,
			result: { relationship: result, operation: request.operation },
			...(batch.hasCandidates ? { evidence: relationshipChange(request, persisted) } : {}),
		});
		return { result, dispatch } satisfies CommittedLifecycleWork<
			typeof saved & { wasInserted: boolean }
		>;
	});
	const persistPreparedUserCreate = Effect.fn("RelationshipsService.persistPreparedUserCreate")(
		function* (
			prepared: PreparedUserRelationshipCreate,
			batch?: { command: LifecycleCommand; identity: ReadonlyArray<string>; index: number },
		) {
			return yield* persistPreparedUserMutation(prepared[preparedUserRelationshipCreate], batch);
		},
	);
	const persistPreparedUserDelete = Effect.fn("RelationshipsService.persistPreparedUserDelete")(
		function* (
			prepared: PreparedUserRelationshipDelete,
			batch?: { command: LifecycleCommand; identity: ReadonlyArray<string>; index: number },
		) {
			return yield* persistPreparedUserMutation(prepared[preparedUserRelationshipDelete], batch);
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
