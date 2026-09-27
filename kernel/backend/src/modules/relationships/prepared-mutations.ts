import { DbError } from "@ryot-app/contract/errors";
import {
	LifecycleCommand,
	type AutomationRelationshipRequestPayload,
	type AutomationRelationshipSnapshot,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import { Cause, Effect, Schema } from "effect";

import type { LifecycleDispatchPlan } from "#lib/domain/lifecycle";
import { lifecycleTrigger } from "#lib/domain/lifecycle-command";
import { catalogDefinitionFingerprint } from "#modules/plugins/runtime-resolver";

import {
	classifyRelationshipReceiptConflict,
	makeRelationshipMutationPrimitives,
} from "./mutation-primitives";
import {
	activeTransactionGuard,
	parseProperties,
	relationshipReceiptIdentity,
	RelationshipRecordedResult,
	rootTransaction,
	rootTransactionGuard,
	snapshot,
	type CreateRelationshipInput,
	type Mutation,
	type RelationshipMutationDependencies,
} from "./mutation-support";
import type { RelationshipIdentityInput } from "./repository";

type CommittedRelationship = {
	readonly dispatch: ReadonlyArray<LifecycleDispatchPlan>;
	readonly relationship: NonNullable<typeof RelationshipRecordedResult.Type.relationship>;
};
type PreparedData =
	| { readonly committed: CommittedRelationship }
	| {
			readonly mutation: Mutation;
			readonly request: AutomationRelationshipRequestPayload;
			readonly before: AutomationRelationshipSnapshot | null;
			readonly requestId: LifecycleCommand["causation"]["parentTriggerId"];
	  };
const preparedUserRelationshipCreate = Symbol("PreparedUserRelationshipCreate");
const preparedUserRelationshipDelete = Symbol("PreparedUserRelationshipDelete");
export type PreparedUserRelationshipCreate = {
	readonly [preparedUserRelationshipCreate]: PreparedData;
};
export type PreparedUserRelationshipDelete = {
	readonly [preparedUserRelationshipDelete]: PreparedData;
};

// The caller owns the larger commit and seals its resource batches after all prepared items.
export const makePreparedRelationshipMutations = (
	dependencies: RelationshipMutationDependencies,
) => {
	const { session, planner, runtime, receipts, execution, repository, definitions } = dependencies;
	const primitives = makeRelationshipMutationPrimitives(dependencies);
	const transaction = rootTransaction(session);
	const assertRootTransaction = rootTransactionGuard(session);
	const assertActiveTransaction = activeTransactionGuard(session);
	const committedReplay = Effect.fnUntraced(function* (
		input: RelationshipIdentityInput,
		command: LifecycleCommand,
		mode: Mutation["mode"],
		properties: unknown,
	) {
		return yield* receipts
			.peek(
				relationshipReceiptIdentity({ mode, input, command, properties }),
				RelationshipRecordedResult,
			)
			.pipe(Effect.mapError(classifyRelationshipReceiptConflict));
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
		const submittedProperties = "properties" in input ? input.properties : undefined;
		const receipt = relationshipReceiptIdentity({
			input,
			command,
			mode: receiptMode,
			properties: submittedProperties,
		});
		const replay = yield* committedReplay(input, command, receiptMode, submittedProperties);
		if (replay) {
			if (!replay.result.relationship) {
				return yield* new DbError({ message: "Committed relationship is missing its result" });
			}
			return {
				committed: { dispatch: replay.dispatch, relationship: replay.result.relationship },
			} satisfies PreparedData;
		}
		let mutation: Mutation = { input, command, receipt, mode: receiptMode };
		if (mode === "create") {
			if (!("properties" in input)) {
				return yield* Effect.die("Prepared relationship create is missing properties");
			}
			const definition = (yield* definitions.findUserRelationshipSchemas(input.userId, [
				input.relationshipSchemaSlug,
			]))[input.relationshipSchemaSlug];
			if (
				!definition ||
				(input.relationshipSchemaPluginId !== undefined &&
					input.relationshipSchemaPluginId !== (definition.pluginId ?? null))
			) {
				return yield* new RelationshipBadRequest({
					reason: { code: "concurrent-relationship-change" },
				});
			}
			mutation = {
				...mutation,
				propertiesSchema: definition.propertiesSchema,
				schemaFingerprint: catalogDefinitionFingerprint(definition),
				input: { ...input, relationshipSchemaPluginId: definition.pluginId ?? null },
				properties: yield* parseProperties(input.properties, definition.propertiesSchema),
			};
		}
		const planned = yield* transaction(
			Effect.gen(function* () {
				yield* primitives.lockMutations([mutation]);
				const row = yield* repository.findRelationship(mutation.input);
				const before = row ? yield* snapshot(row) : null;
				const request = yield* primitives
					.prepareRequest(mutation, before)
					.pipe(Effect.catchTag("RelationshipNotFound", Effect.die));
				if (!request) {
					return null;
				}
				const plan = yield* planner.plan({
					trigger: lifecycleTrigger(command, input.userId, request),
				});
				return { plan, before, request };
			}),
		);
		if (!planned) {
			return null;
		}
		if (planned.plan.trigger?.blockedReason) {
			return yield* new RelationshipBadRequest({ reason: { code: "automation-limit-reached" } });
		}
		const request = yield* primitives
			.applyPolicies(planned.request, planned.plan.policies, mutation)
			.pipe(
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
		return {
			request,
			mutation,
			before: planned.before,
			requestId: planned.plan.trigger?.id ?? null,
		} satisfies PreparedData;
	});
	const prepareUserCreate = Effect.fn("RelationshipsService.prepareUserCreate")(function* (
		input: CreateRelationshipInput,
		command: LifecycleCommand,
	) {
		const value = yield* prepareUserMutation(input, command, "create");
		return value === null ? null : Object.freeze({ [preparedUserRelationshipCreate]: value });
	});
	const prepareUserDelete = Effect.fn("RelationshipsService.prepareUserDelete")(function* (
		input: RelationshipIdentityInput,
		command: LifecycleCommand,
	) {
		const value = yield* prepareUserMutation(input, command, "delete");
		return value === null ? null : Object.freeze({ [preparedUserRelationshipDelete]: value });
	});
	const persistPreparedUserMutation = Effect.fnUntraced(function* (
		prepared: PreparedData,
		batchInput?: { command: LifecycleCommand; identity: ReadonlyArray<string>; index: number },
	) {
		yield* assertActiveTransaction;
		if ("committed" in prepared) {
			return { dispatch: prepared.committed.dispatch, result: prepared.committed.relationship };
		}
		const { mutation } = prepared;
		const receipt = relationshipReceiptIdentity(mutation);
		const replay = yield* receipts
			.lookup(receipt, RelationshipRecordedResult)
			.pipe(Effect.mapError(classifyRelationshipReceiptConflict));
		if (replay) {
			if (!replay.result.relationship) {
				return yield* new DbError({ message: "Committed relationship is missing its result" });
			}
			return { dispatch: replay.dispatch, result: replay.result.relationship };
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
		let request = prepared.request;
		if (request.operation !== "delete") {
			yield* runtime.lockCatalog();
			request = yield* primitives.revalidateRequest(mutation, request);
		}
		yield* primitives.lockMutations([mutation]);
		const { payload, ...result } = yield* primitives
			.persistSource(mutation, request, prepared.before, true)
			.pipe(
				Effect.catchTag(
					"RelationshipNotFound",
					() => new RelationshipBadRequest({ reason: { code: "concurrent-relationship-change" } }),
				),
			);
		if (!payload || !result.relationship) {
			return yield* Effect.die("Prepared relationship write is missing its result");
		}
		const { change, dispatch } = yield* primitives.planChange({
			payload,
			mutation,
			requestId: prepared.requestId,
		});
		yield* primitives.recordResult({
			batch,
			result,
			dispatch,
			evidence: change,
			identity: receipt,
			index: batchInput?.index ?? 0,
		});
		return { dispatch, result: result.relationship };
	});
	const persistPreparedUserCreate = Effect.fn("RelationshipsService.persistPreparedUserCreate")(
		(
			prepared: PreparedUserRelationshipCreate,
			batch?: { command: LifecycleCommand; identity: ReadonlyArray<string>; index: number },
		) => persistPreparedUserMutation(prepared[preparedUserRelationshipCreate], batch),
	);
	const persistPreparedUserDelete = Effect.fn("RelationshipsService.persistPreparedUserDelete")(
		(
			prepared: PreparedUserRelationshipDelete,
			batch?: { command: LifecycleCommand; identity: ReadonlyArray<string>; index: number },
		) => persistPreparedUserMutation(prepared[preparedUserRelationshipDelete], batch),
	);
	return {
		committedReplay,
		prepareUserCreate,
		prepareUserDelete,
		persistPreparedUserCreate,
		persistPreparedUserDelete,
	};
};
