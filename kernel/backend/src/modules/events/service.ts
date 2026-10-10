import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEventDraft,
	type AutomationEventChangePayload,
	type AutomationEventSnapshot,
	type AutomationPolicyPatch,
	type AutomationRequestPayload,
	type AutomationWarning,
	LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	type CreateEventItem,
	type EventCreateItemError,
	EventBadRequest,
	EventNotFound,
	EventOperationNotFound,
	type EventUpdatePatch,
	EventStale,
	type UpdateEventItem,
	type EventCreateOperation,
} from "@ryot-app/contract/modules/events/schemas";
import type { AutomationTriggerId, EventId, UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { stableStringify } from "@ryot-app/ts-utils/json";
import {
	Cause,
	Clock,
	Context,
	DateTime,
	Duration,
	Effect,
	Layer,
	Option,
	Redacted,
	Schema,
} from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import {
	type CommittedLifecycleWork,
	type LifecycleDispatchPlan,
	LifecyclePersistenceError,
	LifecyclePlanner,
	toLifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import { lifecycleTrigger } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import {
	applyLifecyclePolicyPatch,
	canonicalLifecyclePolicyPatch,
} from "#lib/domain/lifecycle-policy-patch";
import { AppConfig } from "#lib/infrastructure/config/service";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import {
	createWorkflowJobId,
	deriveJobIdSecret,
	resolveWorkflowJob,
	type WorkflowJob,
} from "#lib/shared/job-id";
import { toWorkflowRunResult } from "#lib/shared/workflow-result";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	catalogDefinitionFingerprint,
	type CatalogDefinitionFingerprint,
} from "#modules/plugins/runtime-resolver";

import { enqueueEventCreate, EventCreateWorkflow } from "./event-create-workflow";
import {
	capturedEventReferences,
	resolveEventCreateItemScopes,
	validateCapturedEventReferences,
} from "./event-creation";
import type { CapturedEventReferences } from "./event-creation";
import {
	EventMutationBatchReceiptResult,
	EventMutationReceiptResult,
	eventMutationBatchReceiptIdentity,
	eventMutationReceiptIdentity,
	eventCreateBatchInput,
	eventReceiptError,
} from "./mutation-receipts";
import {
	EventsRepository,
	type EventIdentityInput,
	type UpdateEventEntityReferencesInput,
} from "./repository";
import { eventRootTransaction } from "./transaction";

type EventRequest = Extract<
	AutomationRequestPayload,
	{ resource: "event"; operation: "update" | "delete" }
>;
type PreparedEventMutationData = {
	readonly before: AutomationEventSnapshot;
	readonly command: LifecycleCommand;
	readonly input: EventIdentityInput;
	readonly expectedRevision: number;
	readonly requestId: AutomationTriggerId | null;
} & (
	| { readonly operation: "delete" }
	| {
			readonly operation: "move";
			readonly move: UpdateEventEntityReferencesInput;
			readonly draft: AutomationEventDraft;
			readonly referenceContextFingerprint: string;
			readonly eventSchemaFingerprint: CatalogDefinitionFingerprint;
			readonly propertiesSchema: AppSchema;
			readonly capturedReferences: CapturedEventReferences;
	  }
	| {
			readonly operation: "edit";
			readonly submitted: UpdateEventItem;
			readonly draft: AutomationEventDraft;
			readonly referenceContextFingerprint: string;
			readonly eventSchemaFingerprint: CatalogDefinitionFingerprint;
			readonly propertiesSchema: AppSchema;
			readonly capturedReferences: CapturedEventReferences;
	  }
);
const preparedEventUpdate = Symbol("PreparedEventUpdate");
const preparedEventMoveReferences = Symbol("PreparedEventMoveReferences");
const preparedEventDelete = Symbol("PreparedEventDelete");
export type PreparedEventUpdate = {
	readonly [preparedEventUpdate]: Extract<PreparedEventMutationData, { operation: "edit" }>;
};
export type PreparedEventMoveReferences = {
	readonly [preparedEventMoveReferences]: Extract<PreparedEventMutationData, { operation: "move" }>;
};
export type PreparedEventDelete = {
	readonly [preparedEventDelete]: Extract<PreparedEventMutationData, { operation: "delete" }>;
};

type EventMutationReceiptInput =
	| { readonly operation: "delete" }
	| { readonly operation: "edit"; readonly submitted: UpdateEventItem }
	| { readonly operation: "move"; readonly move: UpdateEventEntityReferencesInput };
type EventMutationBatchReplay = {
	readonly result: typeof EventMutationBatchReceiptResult.Type;
	readonly dispatch: ReadonlyArray<LifecycleDispatchPlan>;
};
type PreparedEventMutationResult =
	| PreparedEventMutationData
	| { readonly _tag: "Committed"; readonly work: CommittedLifecycleWork<EventId | null> };

const eventDraft = ({
	id: _id,
	createdAt: _createdAt,
	updatedAt: _updatedAt,
	...draft
}: AutomationEventSnapshot) => draft;

const eventBadRequest = (
	code:
		| "automation-limit"
		| "invalid-policy-transform"
		| "invalid-properties"
		| "mutation-conflict"
		| "policy-execution-failed"
		| "policy-rejected",
	message: string,
) => new EventBadRequest({ reason: { code, message } });
const receiptIdentityFailure = (error: DbError) =>
	error.message === "Conflicting event command identity"
		? eventBadRequest("mutation-conflict", error.message)
		: error;
const publicDeleteFailure = (error: DbError) => {
	if (error.message === "Event request exceeds automation limits") {
		return eventBadRequest("automation-limit", error.message);
	}
	if (error.message.startsWith("Event policy execution failed:")) {
		return eventBadRequest("policy-execution-failed", error.message);
	}
	if (error.message.startsWith("Event policy cannot transform")) {
		return eventBadRequest("invalid-policy-transform", error.message);
	}
	if (error.message.startsWith("Event policy rejected")) {
		return eventBadRequest("policy-rejected", error.message);
	}
	return error;
};
const eventCreateFailure = (error: EventCreateItemError) =>
	eventBadRequest("mutation-conflict", `Event reference is not writable: ${error.reason.code}`);

const applyUpdatePatch = (before: AutomationEventSnapshot, patch: EventUpdatePatch) => {
	const properties = { ...before.properties };
	if (patch.properties) {
		for (const key of patch.properties.remove) {
			delete properties[key];
		}
		Object.assign(properties, patch.properties.set);
	}
	return {
		...eventDraft(before),
		properties,
		...(patch.entityId === undefined ? {} : { entityId: patch.entityId }),
		...(patch.occurredAt === undefined ? {} : { occurredAt: patch.occurredAt }),
		...(patch.sessionEntityId === undefined ? {} : { sessionEntityId: patch.sessionEntityId }),
	};
};

const mutationReceiptInput = (prepared: PreparedEventMutationData): EventMutationReceiptInput => {
	if (prepared.operation === "edit") {
		return { operation: "edit", submitted: prepared.submitted };
	}
	if (prepared.operation === "move") {
		return { operation: "move", move: prepared.move };
	}
	return { operation: "delete" };
};

const indexedCommand = (command: LifecycleCommand, index: number): LifecycleCommand => ({
	...command,
	itemIdentity: `${command.itemIdentity}:event:${index}`,
});

export class EventsService extends Context.Service<EventsService>()("EventsService", {
	make: Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const config = yield* AppConfig;
		const operationSecret = deriveJobIdSecret(
			Redacted.value(config.server.adminAccessToken),
			"events-operation-id",
		);
		const repository = yield* EventsRepository;
		const entities = yield* EntitiesRepository;
		const eventSchemas = yield* EventSchemasRepository;
		const session = yield* DatabaseSession;
		const planner = yield* LifecyclePlanner;
		const receipts = yield* MutationReceipts.make;
		const lookupReceipt = (
			input: EventIdentityInput,
			command: LifecycleCommand,
			mutation: EventMutationReceiptInput,
			lock = true,
		) =>
			(lock ? receipts.lookup : receipts.peek)(
				eventMutationReceiptIdentity(input, command, mutation),
				EventMutationReceiptResult,
			).pipe(Effect.mapError(eventReceiptError));
		const execution = yield* LifecycleExecution;
		const verifyCreateBatchInput = (
			input: { userId: UserId; payload: ReadonlyArray<CreateEventItem> },
			command: LifecycleCommand,
		) =>
			receipts
				.peekBatch(
					receipts.batchIdentity({
						...eventCreateBatchInput({ ...input, command }),
						ownerUserId: input.userId,
					}),
				)
				.pipe(Effect.mapError(eventReceiptError));
		const transaction = eventRootTransaction(
			session,
			"Event lifecycle mutations require a root transaction boundary",
		);
		const assertRootTransaction = session.requireRoot.pipe(
			Effect.mapError(
				() =>
					new DbError({ message: "Event lifecycle mutations require a root transaction boundary" }),
			),
		);
		const assertActiveTransaction = session.requireTransaction.pipe(
			Effect.mapError(() => new LifecyclePersistenceError({ code: "active-transaction-required" })),
		);
		const create = Effect.fn("EventsService.create")(function* (
			input: {
				readonly userId: UserId;
				readonly payload: ReadonlyArray<CreateEventItem>;
				readonly itemIdentities?: ReadonlyArray<string>;
			},
			command: LifecycleCommand,
		) {
			if (input.payload.length === 0) {
				return { count: 0, outcomes: [], warnings: [], failure: null };
			}
			yield* verifyCreateBatchInput(input, command);
			const result = yield* enqueueEventCreate({ ...input, command }).pipe(
				Effect.provideService(WorkflowEngine, engine),
				Effect.provideService(DatabaseSession, session),
			);
			yield* verifyCreateBatchInput(input, command);
			return result;
		});
		const operationState = Effect.fn("EventsService.operationState")(function* (
			userId: UserId,
			job: WorkflowJob,
			totalItems: number,
		): Effect.fn.Return<Schema.Schema.Type<typeof EventCreateOperation>, DbError> {
			const { lane, executionId } = job;
			const operationId = createWorkflowJobId(
				operationSecret,
				{ lane, executionId: `${executionId}:${totalItems}` },
				userId,
			);
			const result = toWorkflowRunResult(
				Option.getOrUndefined(yield* engine.poll(EventCreateWorkflow.forLane(lane), executionId)),
				{ onSuccess: (value) => ({ result: value }) },
			);
			if (result.status === "failed") {
				return { operationId, status: "failed", reason: "unexpected-error" };
			}
			const progress = yield* repository.getCreateProgress(userId, executionId);
			if (result.status === "completed" && !progress.requiredPending) {
				return { operationId, status: "completed", result: result.result };
			}
			return progress.writtenCount > 0
				? {
						operationId,
						writtenCount: progress.writtenCount,
						status: "committed-follow-up-pending",
						writesPending: result.status !== "completed" && progress.writtenCount < totalItems,
					}
				: { operationId, writtenCount: 0, status: "accepted", writesPending: true };
		});
		const createHttp = Effect.fn("EventsService.createHttp")(function* (
			input: { readonly userId: UserId; readonly payload: ReadonlyArray<CreateEventItem> },
			command: LifecycleCommand,
		) {
			if (input.payload.length === 0) {
				return { count: 0, outcomes: [], warnings: [], failure: null };
			}
			yield* verifyCreateBatchInput(input, command);
			const started = yield* Clock.currentTimeMillis;
			const job = { lane: command.causation.lane, executionId: command.causation.executionId };
			yield* dispatchAdmittedWorkflow(
				receipts,
				engine,
				EventCreateWorkflow.forLane(job.lane),
				command.accountGeneration,
				{ discard: true, executionId: job.executionId, payload: { ...input, command } },
				(admission) => admission,
				(dispatch) => dispatch.pipe(Effect.uninterruptible),
			);
			const remaining = Math.max(0, 35_000 - ((yield* Clock.currentTimeMillis) - started));
			const observed = yield* Effect.gen(function* () {
				for (;;) {
					const state = yield* operationState(input.userId, job, input.payload.length);
					if (state.status === "completed" || state.status === "failed") {
						return state;
					}
					yield* Effect.sleep(Duration.millis(500));
				}
			}).pipe(Effect.timeoutOption(Duration.millis(remaining)));
			const state = Option.isSome(observed)
				? observed.value
				: yield* operationState(input.userId, job, input.payload.length);
			yield* verifyCreateBatchInput(input, command);
			if (state.status === "completed") {
				return state.result;
			}
			if (state.status === "failed") {
				return yield* new DbError({ message: "Event creation failed" });
			}
			return state;
		});
		const getCreateOperation = Effect.fn("EventsService.getCreateOperation")(function* (
			userId: UserId,
			operationId: string,
		) {
			const identity = resolveWorkflowJob(operationSecret, userId, operationId);
			const separator = identity?.executionId.lastIndexOf(":") ?? -1;
			const executionId = identity?.executionId.slice(0, separator);
			const totalItems = Number(identity?.executionId.slice(separator + 1));
			if (!identity || !executionId || !Number.isSafeInteger(totalItems) || totalItems < 1) {
				return yield* new EventOperationNotFound({ reason: { code: "operation-not-found" } });
			}
			return yield* operationState(userId, { executionId, lane: identity.lane }, totalItems);
		});

		const lookupEditReceipt = (
			input: EventIdentityInput,
			command: LifecycleCommand,
			mutation: Extract<EventMutationReceiptInput, { operation: "edit" }>,
			lock = true,
		) =>
			lookupReceipt(input, command, mutation, lock).pipe(Effect.mapError(receiptIdentityFailure));
		const resolveEventScopes = (input: Parameters<typeof resolveEventCreateItemScopes>[0]) =>
			resolveEventCreateItemScopes(input).pipe(
				Effect.provideService(EntitiesRepository, entities),
				Effect.provideService(EventSchemasRepository, eventSchemas),
			);
		const resolveEditContext = Effect.fnUntraced(function* (
			userId: UserId,
			before: AutomationEventSnapshot,
			draftInput: AutomationEventDraft,
			previousReferences: CapturedEventReferences = {},
			pinnedSchema?: {
				eventSchemaFingerprint: CatalogDefinitionFingerprint;
				propertiesSchema: AppSchema;
			},
		) {
			if (
				draftInput.eventSchemaSlug !== before.eventSchemaSlug ||
				draftInput.entitySchemaSlug !== before.entitySchemaSlug
			) {
				return yield* eventBadRequest(
					"invalid-policy-transform",
					"Event schema identity is immutable",
				);
			}
			const scope = yield* resolveEventScopes({
				userId,
				item: { ...draftInput, sessionEntityId: draftInput.sessionEntityId ?? undefined },
			}).pipe(
				Effect.catchTag("EventCreateItemError", (error) => Effect.fail(eventCreateFailure(error))),
			);
			if (scope.entityScope.entitySchemaSlug !== before.entitySchemaSlug) {
				return yield* eventBadRequest(
					"mutation-conflict",
					"Event entity schema does not match its event schema",
				);
			}
			const eventSchemaFingerprint = catalogDefinitionFingerprint(scope.eventSchemaScope);
			if (
				pinnedSchema &&
				stableStringify(eventSchemaFingerprint) !==
					stableStringify(pinnedSchema.eventSchemaFingerprint)
			) {
				return yield* eventBadRequest(
					"invalid-policy-transform",
					"Event schema changed while lifecycle policies ran",
				);
			}
			const propertiesSchema =
				pinnedSchema?.propertiesSchema ?? scope.eventSchemaScope.propertiesSchema;
			const properties = yield* parseAppSchemaProperties({
				kind: "Event",
				propertiesSchema,
				properties: draftInput.properties,
			}).pipe(
				Effect.mapError(() =>
					eventBadRequest("invalid-properties", "Event properties are invalid"),
				),
			);
			const draft = yield* Schema.decodeUnknownEffect(AutomationEventDraft)({
				...draftInput,
				properties,
				entityId: scope.entityId,
				eventSchemaSlug: scope.eventSchemaScope.id,
				occurredAt: scope.occurredAt.toISOString(),
				sessionEntityId: scope.sessionEntityId ?? null,
				entitySchemaSlug: scope.entityScope.entitySchemaSlug,
			}).pipe(
				Effect.mapError(() =>
					eventBadRequest("invalid-properties", "Event properties are invalid"),
				),
			);
			const capturedReferences = yield* capturedEventReferences(
				userId,
				draft,
				previousReferences,
			).pipe(
				Effect.provideService(EntitiesRepository, entities),
				Effect.catchTag("EventCreateItemError", (error) => Effect.fail(eventCreateFailure(error))),
			);
			const referenceIds = [
				...new Set([
					draft.entityId,
					...(draft.sessionEntityId === null ? [] : [draft.sessionEntityId]),
				]),
			].sort();
			const references = referenceIds.map((entityId) => ({
				entityId,
				fingerprint: capturedReferences[entityId],
			}));
			return {
				draft,
				propertiesSchema,
				capturedReferences,
				eventSchemaFingerprint,
				referenceContextFingerprint: stableStringify({
					references,
					eventSchema: eventSchemaFingerprint,
				}),
			};
		});
		const prepareUpdate = Effect.fn("EventsService.prepareUpdate")(function* (
			submitted: UpdateEventItem,
			userId: UserId,
			commandInput: LifecycleCommand,
		) {
			yield* assertRootTransaction;
			const input = { userId, eventId: submitted.eventId };
			const command = yield* Schema.decodeEffect(LifecycleCommand)(commandInput).pipe(
				Effect.mapError(() => new DbError({ message: "Invalid event lifecycle command" })),
			);
			const receiptInput = { submitted, operation: "edit" as const };
			const prepared = yield* transaction(
				Effect.gen(function* () {
					if (yield* lookupEditReceipt(input, command, receiptInput)) {
						return null;
					}
					const before = yield* repository.getEventSnapshot(input);
					if (!before) {
						return yield* new EventNotFound({
							reason: { code: "event-not-found", eventId: submitted.eventId },
						});
					}
					const expectedRevision = yield* repository.getEventRevision(input);
					if (expectedRevision === null) {
						return yield* new EventNotFound({
							reason: { code: "event-not-found", eventId: submitted.eventId },
						});
					}
					const initial = yield* resolveEditContext(userId, before, {
						...eventDraft(before),
						...applyUpdatePatch(before, submitted.patch),
					});
					const request: EventRequest = {
						before,
						resource: "event",
						category: "request",
						operation: "update",
						draft: initial.draft,
					};
					const plan = yield* planner.plan({ trigger: lifecycleTrigger(command, userId, request) });
					return {
						plan,
						input,
						before,
						command,
						request,
						expectedRevision,
						draft: initial.draft,
						_tag: "Planned" as const,
						propertiesSchema: initial.propertiesSchema,
						capturedReferences: initial.capturedReferences,
						eventSchemaFingerprint: initial.eventSchemaFingerprint,
					};
				}),
			);
			if (!prepared) {
				return null;
			}
			if (prepared.plan.trigger?.blockedReason) {
				return yield* eventBadRequest(
					"automation-limit",
					"Event request exceeds automation limits",
				);
			}
			let request = prepared.request;
			let draft = prepared.draft;
			let capturedReferences = prepared.capturedReferences;
			const pinnedSchema = {
				propertiesSchema: prepared.propertiesSchema,
				eventSchemaFingerprint: prepared.eventSchemaFingerprint,
			};
			const acceptedPatches: AutomationPolicyPatch[] = [];
			const orderedPolicies = [...prepared.plan.policies].sort((left, right) => {
				const leftRun = prepared.plan.runs.find((run) => run.id === left.runId);
				const rightRun = prepared.plan.runs.find((run) => run.id === right.runId);
				return (
					left.position - right.position ||
					(leftRun?.pluginId ?? "").localeCompare(rightRun?.pluginId ?? "") ||
					(leftRun?.hookSlug ?? "").localeCompare(rightRun?.hookSlug ?? "")
				);
			});
			yield* Effect.gen(function* () {
				for (const policy of orderedPolicies) {
					const output = yield* execution
						.executePolicy({ runId: policy.runId, acceptedPatches: [...acceptedPatches] })
						.pipe(
							Effect.mapError((error) =>
								eventBadRequest(
									"policy-execution-failed",
									`Event policy execution failed: ${error.runId}`,
								),
							),
						);
					if (output.action === "reject") {
						return yield* eventBadRequest(
							"policy-rejected",
							`Event policy rejected mutation: ${policy.runId}`,
						);
					}
					if (output.action === "transform") {
						const patched = applyLifecyclePolicyPatch(request, output.patch);
						if (!patched.ok) {
							return yield* eventBadRequest("invalid-policy-transform", patched.reason);
						}
						const validated = yield* resolveEditContext(
							userId,
							prepared.before,
							patched.request.draft,
							capturedReferences,
							pinnedSchema,
						);
						const successor = { ...patched.request, draft: validated.draft };
						const accepted = canonicalLifecyclePolicyPatch(request, successor);
						request = successor;
						draft = validated.draft;
						capturedReferences = validated.capturedReferences;
						if (accepted) {
							acceptedPatches.push(accepted);
						}
					}
				}
				return undefined;
			}).pipe(
				Effect.catchCauseIf(
					(cause) => !Cause.hasInterruptsOnly(cause),
					(cause) =>
						prepared.plan.trigger === null
							? Effect.failCause(cause)
							: execution
									.skipQueuedPolicies({ triggerId: prepared.plan.trigger.id })
									.pipe(Effect.andThen(Effect.failCause(cause)), Effect.uninterruptible),
				),
			);
			const context = yield* resolveEditContext(
				userId,
				prepared.before,
				draft,
				capturedReferences,
				pinnedSchema,
			);
			return Object.freeze({
				[preparedEventUpdate]: {
					submitted,
					draft: context.draft,
					input: prepared.input,
					before: prepared.before,
					command: prepared.command,
					operation: "edit" as const,
					propertiesSchema: context.propertiesSchema,
					expectedRevision: prepared.expectedRevision,
					requestId: prepared.plan.trigger?.id ?? null,
					capturedReferences: context.capturedReferences,
					eventSchemaFingerprint: context.eventSchemaFingerprint,
					referenceContextFingerprint: context.referenceContextFingerprint,
				},
			});
		});

		const recordNoop = (
			input: EventIdentityInput,
			command: LifecycleCommand,
			mutation: EventMutationReceiptInput,
		) =>
			receipts.insert({
				dispatch: [],
				result: { eventId: null },
				identity: eventMutationReceiptIdentity(input, command, mutation),
			});
		const prepareMoveOrDelete = Effect.fnUntraced(function* (
			input: EventIdentityInput,
			commandInput: LifecycleCommand,
			move?: UpdateEventEntityReferencesInput,
			inline = false,
		): Effect.fn.Return<
			PreparedEventMutationResult | null,
			DbError | EventStale | LifecyclePersistenceError
		> {
			yield* assertRootTransaction;
			const command = yield* Schema.decodeEffect(LifecycleCommand)(commandInput).pipe(
				Effect.mapError(() => new DbError({ message: "Invalid event lifecycle command" })),
			);
			const mutation: EventMutationReceiptInput = move
				? { move, operation: "move" }
				: { operation: "delete" };
			const planned = yield* transaction(
				Effect.gen(function* () {
					const replay = yield* lookupReceipt(input, command, mutation);
					if (replay) {
						if (!inline) {
							return null;
						}
						const batch =
							replay.result.eventId === null
								? []
								: yield* planner.planBatch({
										command,
										resource: "event",
										identity: [command.itemIdentity],
									});
						return {
							_tag: "Committed" as const,
							work: { result: replay.result.eventId, dispatch: [...replay.dispatch, ...batch] },
						};
					}
					const recordNoopWork = Effect.gen(function* () {
						yield* recordNoop(input, command, mutation);
						return { _tag: "Committed" as const, work: { result: null, dispatch: [] } };
					});
					const before = yield* repository.getEventSnapshot(input);
					if (!before) {
						return inline ? yield* recordNoopWork : null;
					}
					const expectedRevision = yield* repository.getEventRevision(input);
					if (expectedRevision === null) {
						return inline ? yield* recordNoopWork : null;
					}
					let request: EventRequest;
					let draft: AutomationEventDraft | undefined;
					let referenceContextFingerprint: string | undefined;
					let eventSchemaFingerprint: CatalogDefinitionFingerprint | undefined;
					let propertiesSchema: AppSchema | undefined;
					let capturedReferences: CapturedEventReferences | undefined;
					if (move) {
						if (
							move.mergeFrom === move.mergeInto ||
							(before.entityId !== move.mergeFrom && before.sessionEntityId !== move.mergeFrom)
						) {
							return inline ? yield* recordNoopWork : null;
						}
						const draftInput = yield* Schema.decodeEffect(AutomationEventDraft)({
							...eventDraft(before),
							entityId: before.entityId === move.mergeFrom ? move.mergeInto : before.entityId,
							sessionEntityId:
								before.sessionEntityId === move.mergeFrom ? move.mergeInto : before.sessionEntityId,
						}).pipe(Effect.mapError(() => new DbError({ message: "Invalid event update draft" })));
						const context = yield* resolveEditContext(input.userId, before, draftInput).pipe(
							Effect.mapError(
								(error) => new DbError({ message: `Invalid event move context: ${error.message}` }),
							),
						);
						draft = context.draft;
						referenceContextFingerprint = context.referenceContextFingerprint;
						eventSchemaFingerprint = context.eventSchemaFingerprint;
						propertiesSchema = context.propertiesSchema;
						capturedReferences = context.capturedReferences;
						request = {
							before,
							resource: "event",
							category: "request",
							operation: "update",
							draft: context.draft,
						};
					} else {
						request = {
							draft: before,
							resource: "event",
							category: "request",
							operation: "delete",
						};
					}
					const plan = yield* planner.plan({
						trigger: lifecycleTrigger(command, input.userId, request),
					});
					if (plan.trigger?.blockedReason) {
						return yield* new DbError({ message: "Event request exceeds automation limits" });
					}
					const makePrepared = (
						parentTriggerId: AutomationTriggerId | null,
					): PreparedEventMutationData | null => {
						if (!move) {
							return {
								input,
								before,
								command,
								expectedRevision,
								operation: "delete",
								requestId: parentTriggerId,
							};
						}
						if (
							!draft ||
							referenceContextFingerprint === undefined ||
							eventSchemaFingerprint === undefined ||
							propertiesSchema === undefined ||
							capturedReferences === undefined
						) {
							return null;
						}
						return {
							move,
							input,
							draft,
							before,
							command,
							expectedRevision,
							propertiesSchema,
							operation: "move",
							capturedReferences,
							eventSchemaFingerprint,
							requestId: parentTriggerId,
							referenceContextFingerprint,
						};
					};
					if (inline && plan.policies.length === 0) {
						const prepared = makePrepared(plan.trigger?.id ?? null);
						if (!prepared) {
							return yield* new DbError({ message: "Missing validated event move context" });
						}
						return {
							_tag: "Committed" as const,
							work: yield* withBatch(command, persist(prepared)),
						};
					}
					return {
						plan,
						input,
						draft,
						before,
						command,
						request,
						expectedRevision,
						propertiesSchema,
						capturedReferences,
						eventSchemaFingerprint,
						_tag: "Planned" as const,
						referenceContextFingerprint,
					};
				}),
			);
			if (!planned) {
				return null;
			}
			if (planned._tag === "Committed") {
				return planned;
			}
			let request = planned.request;
			let draft = planned.draft;
			let referenceContextFingerprint = planned.referenceContextFingerprint;
			let capturedReferences = planned.capturedReferences;
			const acceptedPatches: AutomationPolicyPatch[] = [];
			yield* Effect.gen(function* () {
				for (const policy of planned.plan.policies) {
					const output = yield* execution
						.executePolicy({ runId: policy.runId, acceptedPatches: [...acceptedPatches] })
						.pipe(
							Effect.catchTag("AutomationPolicyExecutionError", (error) =>
								Effect.fail(
									new DbError({ message: `Event policy execution failed: ${error.runId}` }),
								),
							),
						);
					if (output.action === "reject") {
						return yield* new DbError({ message: "Event policy rejected mutation" });
					}
					if (output.action === "transform") {
						if (!move || request.operation !== "update") {
							return yield* new DbError({ message: "Event policy cannot transform this mutation" });
						}
						const patched = applyLifecyclePolicyPatch(request, output.patch);
						if (!patched.ok) {
							return yield* new DbError({ message: "Event policy cannot transform this mutation" });
						}
						if (
							planned.eventSchemaFingerprint === undefined ||
							planned.propertiesSchema === undefined ||
							capturedReferences === undefined
						) {
							return yield* new DbError({ message: "Missing validated event move context" });
						}
						const context = yield* resolveEditContext(
							input.userId,
							planned.before,
							patched.request.draft,
							capturedReferences,
							{
								propertiesSchema: planned.propertiesSchema,
								eventSchemaFingerprint: planned.eventSchemaFingerprint,
							},
						).pipe(
							Effect.mapError(
								(error) => new DbError({ message: `Invalid event move context: ${error.message}` }),
							),
						);
						const successor = { ...patched.request, draft: context.draft };
						const accepted = canonicalLifecyclePolicyPatch(request, successor);
						request = successor;
						draft = context.draft;
						referenceContextFingerprint = context.referenceContextFingerprint;
						capturedReferences = context.capturedReferences;
						if (accepted) {
							acceptedPatches.push(accepted);
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
			const requestId = planned.plan.trigger?.id ?? null;
			if (move) {
				if (
					!draft ||
					referenceContextFingerprint === undefined ||
					planned.eventSchemaFingerprint === undefined ||
					planned.propertiesSchema === undefined ||
					capturedReferences === undefined
				) {
					return yield* new DbError({ message: "Missing validated event move context" });
				}
				return {
					move,
					draft,
					requestId,
					capturedReferences,
					input: planned.input,
					before: planned.before,
					command: planned.command,
					operation: "move" as const,
					referenceContextFingerprint,
					propertiesSchema: planned.propertiesSchema,
					expectedRevision: planned.expectedRevision,
					eventSchemaFingerprint: planned.eventSchemaFingerprint,
				};
			}
			return {
				requestId,
				input: planned.input,
				before: planned.before,
				command: planned.command,
				operation: "delete" as const,
				expectedRevision: planned.expectedRevision,
			};
		});

		const prepareMoveReferences = Effect.fn("EventsService.prepareMoveReferences")(function* (
			input: UpdateEventEntityReferencesInput,
			command: LifecycleCommand,
		) {
			const value = yield* prepareMoveOrDelete(input, command, input);
			return value && !("_tag" in value) && value.operation === "move"
				? Object.freeze({ [preparedEventMoveReferences]: value })
				: null;
		});
		const prepareDelete = Effect.fn("EventsService.prepareDelete")(function* (
			input: EventIdentityInput,
			command: LifecycleCommand,
		) {
			const value = yield* prepareMoveOrDelete(input, command);
			return value && !("_tag" in value) && value.operation === "delete"
				? Object.freeze({ [preparedEventDelete]: value })
				: null;
		});

		const verifyPreparedEditContext = Effect.fnUntraced(function* (
			prepared: Extract<PreparedEventMutationData, { operation: "edit" | "move" }>,
		) {
			yield* entities.lockEntityReferencesByIds([
				prepared.before.entityId,
				...(prepared.before.sessionEntityId === null ? [] : [prepared.before.sessionEntityId]),
				prepared.draft.entityId,
				...(prepared.draft.sessionEntityId === null ? [] : [prepared.draft.sessionEntityId]),
			]);
			yield* eventSchemas.lockCatalog();
			const current = yield* resolveEditContext(
				prepared.input.userId,
				prepared.before,
				prepared.draft,
				prepared.capturedReferences,
				{
					propertiesSchema: prepared.propertiesSchema,
					eventSchemaFingerprint: prepared.eventSchemaFingerprint,
				},
			).pipe(
				Effect.catchTag("EventBadRequest", () =>
					Effect.fail(
						new EventStale({ reason: { code: "event-stale", eventId: prepared.input.eventId } }),
					),
				),
			);
			if (current.referenceContextFingerprint !== prepared.referenceContextFingerprint) {
				return yield* new EventStale({
					reason: { code: "event-stale", eventId: prepared.input.eventId },
				});
			}
			yield* validateCapturedEventReferences(
				prepared.input.userId,
				prepared.draft,
				prepared.capturedReferences,
			).pipe(
				Effect.provideService(EntitiesRepository, entities),
				Effect.catchTag("EventCreateItemError", () =>
					Effect.fail(
						new EventStale({ reason: { code: "event-stale", eventId: prepared.input.eventId } }),
					),
				),
			);
			return undefined;
		});
		const persist = Effect.fnUntraced(function* (
			prepared: PreparedEventMutationData,
			batchInput?: {
				command: LifecycleCommand;
				identity: ReadonlyArray<string>;
				index: number;
				commandInput?: unknown;
			},
		) {
			yield* assertActiveTransaction;
			const identity = eventMutationReceiptIdentity(
				prepared.input,
				prepared.command,
				mutationReceiptInput(prepared),
			);
			const batchScope = {
				resource: "event" as const,
				command: batchInput?.command ?? prepared.command,
				...(batchInput?.commandInput === undefined
					? {}
					: { commandInput: batchInput.commandInput }),
				identity: batchInput?.identity ?? [prepared.command.itemIdentity],
			};
			const batch = yield* planner.prepareBatch({ ...batchScope, scopes: [prepared.input.userId] });
			const replay = yield* lookupReceipt(
				prepared.input,
				prepared.command,
				mutationReceiptInput(prepared),
			);
			if (replay) {
				return {
					dispatch: replay.dispatch,
					result: replay.result.eventId,
				} satisfies CommittedLifecycleWork<EventId | null>;
			}
			let eventId: EventId;
			let change: AutomationEventChangePayload;
			if (prepared.operation === "edit" || prepared.operation === "move") {
				yield* verifyPreparedEditContext(prepared);
				const updated = yield* repository.updatePreparedEvent({
					...prepared.input,
					draft: prepared.draft,
					before: prepared.before,
					expectedRevision: prepared.expectedRevision,
					updatedAt: DateTime.toDate(DateTime.makeUnsafe(prepared.command.occurredAt)),
					...(prepared.command.causation.eventStreamWorkId === undefined
						? {}
						: { ownerWorkId: prepared.command.causation.eventStreamWorkId }),
				});
				if (!updated) {
					if (prepared.operation === "move") {
						return yield* new DbError({ message: "Event changed while lifecycle policies ran" });
					}
					return yield* new EventStale({
						reason: { code: "event-stale", eventId: prepared.input.eventId },
					});
				}
				const after = yield* repository.getEventSnapshot(prepared.input);
				if (!after) {
					return yield* new DbError({ message: "Updated event disappeared" });
				}
				eventId = updated;
				change = {
					after,
					resource: "event",
					category: "change",
					operation: "update",
					before: prepared.before,
				};
			} else {
				const deleted = yield* repository.deletePreparedEvent({
					...prepared.input,
					before: prepared.before,
					expectedRevision: prepared.expectedRevision,
					...(prepared.command.causation.eventStreamWorkId === undefined
						? {}
						: { ownerWorkId: prepared.command.causation.eventStreamWorkId }),
				});
				if (!deleted) {
					return yield* new DbError({ message: "Event changed while lifecycle policies ran" });
				}
				eventId = deleted;
				change = {
					resource: "event",
					category: "change",
					operation: "delete",
					before: prepared.before,
				};
			}
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
					change,
				),
			});
			const dispatch = plan.trigger === null ? [] : [toLifecycleDispatchPlan(plan)];
			yield* receipts.insert({
				identity,
				dispatch,
				batchId: batch.id,
				result: { eventId },
				batchIndex: batchInput?.index ?? 0,
				...(batch.hasCandidates ? { evidence: change } : {}),
			});
			return { dispatch, result: eventId } satisfies CommittedLifecycleWork<EventId | null>;
		});

		const persistPreparedUpdate = Effect.fn("EventsService.persistPreparedUpdate")(function* (
			prepared: PreparedEventUpdate,
			batch?: {
				command: LifecycleCommand;
				identity: ReadonlyArray<string>;
				index: number;
				commandInput?: unknown;
			},
		) {
			return yield* persist(prepared[preparedEventUpdate], batch);
		});
		const persistPreparedMoveReferences = Effect.fn("EventsService.persistPreparedMoveReferences")(
			function* (
				prepared: PreparedEventMoveReferences,
				batch?: { command: LifecycleCommand; identity: ReadonlyArray<string>; index: number },
			) {
				return yield* persist(prepared[preparedEventMoveReferences], batch);
			},
		);
		const persistPreparedDelete = Effect.fn("EventsService.persistPreparedDelete")(function* (
			prepared: PreparedEventDelete,
			batch?: { command: LifecycleCommand; identity: ReadonlyArray<string>; index: number },
		) {
			return yield* persist(prepared[preparedEventDelete], batch);
		});
		const withBatch = Effect.fnUntraced(function* (
			command: LifecycleCommand,
			persisted: Effect.Effect<
				CommittedLifecycleWork<EventId | null>,
				Effect.Error<ReturnType<typeof persist>>
			>,
			commandInput?: unknown,
		) {
			const work = yield* persisted;
			const batch = yield* planner.planBatch({
				command,
				resource: "event",
				identity: [command.itemIdentity],
				...(commandInput === undefined ? {} : { commandInput }),
			});
			return { ...work, dispatch: [...work.dispatch, ...batch] };
		});
		const replaySingle = Effect.fnUntraced(function* (
			input: EventIdentityInput,
			command: LifecycleCommand,
			mutation: EventMutationReceiptInput,
		) {
			const recorded = yield* mutation.operation === "edit"
				? lookupEditReceipt(input, command, mutation, false)
				: lookupReceipt(input, command, mutation, false);
			if (!recorded) {
				return null;
			}
			const batch =
				recorded.result.eventId === null
					? []
					: yield* transaction(
							planner.planBatch({ command, resource: "event", identity: [command.itemIdentity] }),
						);
			return {
				eventId: recorded.result.eventId,
				warnings: yield* execution.dispatch([...recorded.dispatch, ...batch]),
			};
		});
		const edit = Effect.fn("EventsService.edit")(function* (
			submitted: UpdateEventItem,
			userId: UserId,
			command: LifecycleCommand,
		) {
			yield* assertRootTransaction;
			const input = { userId, eventId: submitted.eventId };
			const mutation = { submitted, operation: "edit" as const };
			const replay = yield* replaySingle(input, command, mutation);
			if (replay) {
				return replay;
			}
			const prepared = yield* prepareUpdate(submitted, userId, command);
			if (!prepared) {
				const racedReplay = yield* replaySingle(input, command, mutation);
				if (racedReplay) {
					return racedReplay;
				}
				return yield* new EventNotFound({
					reason: { code: "event-not-found", eventId: submitted.eventId },
				});
			}
			const work = yield* transaction(withBatch(command, persist(prepared[preparedEventUpdate])));
			return { eventId: work.result, warnings: yield* execution.dispatch(work.dispatch) };
		});
		const deleteOne = Effect.fn("EventsService.delete")(function* (
			input: EventIdentityInput,
			command: LifecycleCommand,
		) {
			yield* assertRootTransaction;
			const mutation = { operation: "delete" as const };
			const replay = yield* replaySingle(input, command, mutation);
			if (replay) {
				return replay;
			}
			const prepared = yield* prepareMoveOrDelete(input, command, undefined, true).pipe(
				Effect.mapError((error) => (error instanceof DbError ? publicDeleteFailure(error) : error)),
			);
			if (!prepared) {
				const racedReplay = yield* replaySingle(input, command, mutation);
				if (racedReplay) {
					return racedReplay;
				}
				return yield* new EventNotFound({
					reason: { eventId: input.eventId, code: "event-not-found" },
				});
			}
			const work =
				"_tag" in prepared
					? prepared.work
					: yield* transaction(withBatch(command, persist(prepared))).pipe(
							Effect.catchTag("DbError", (error) =>
								error.message.includes("changed while lifecycle policies ran")
									? Effect.fail(
											new EventStale({ reason: { code: "event-stale", eventId: input.eventId } }),
										)
									: Effect.fail(error),
							),
						);
			return { eventId: work.result, warnings: yield* execution.dispatch(work.dispatch) };
		});
		const batchReplay = Effect.fnUntraced(function* (
			input:
				| {
						userId: UserId;
						command: LifecycleCommand;
						items: ReadonlyArray<UpdateEventItem>;
						operation: "edit";
						submitted: ReadonlyArray<UpdateEventItem>;
				  }
				| {
						userId: UserId;
						command: LifecycleCommand;
						items: ReadonlyArray<EventIdentityInput>;
						operation: "delete";
						submitted: ReadonlyArray<EventId>;
				  },
		) {
			const batchIdentity = eventMutationBatchReceiptIdentity({
				userId: input.userId,
				command: input.command,
				submitted: input.submitted,
				operation: input.operation,
			});
			const aggregate = yield* receipts
				.peek(batchIdentity, EventMutationBatchReceiptResult)
				.pipe(Effect.mapError(eventReceiptError), Effect.mapError(receiptIdentityFailure));
			if (aggregate) {
				return aggregate;
			}
			const itemReceipts = yield* transaction(
				Effect.gen(function* () {
					return input.operation === "edit"
						? yield* Effect.forEach(input.items, (item, index) =>
								lookupEditReceipt(
									{ userId: input.userId, eventId: item.eventId },
									indexedCommand(input.command, index),
									{ submitted: item, operation: "edit" },
									false,
								),
							)
						: yield* Effect.forEach(input.items, (item, index) =>
								lookupReceipt(
									{ userId: input.userId, eventId: item.eventId },
									indexedCommand(input.command, index),
									{ operation: "delete" },
									false,
								),
							);
				}),
			);
			if (itemReceipts.some((receipt) => receipt !== null)) {
				return yield* eventBadRequest(
					"mutation-conflict",
					"Event batch item receipts exist without an aggregate receipt",
				);
			}
			return null;
		});
		const dispatchBatchResult = Effect.fnUntraced(function* (replay: EventMutationBatchReplay) {
			return {
				warnings: yield* execution.dispatch(replay.dispatch),
				count: replay.result.eventIds.filter((eventId) => eventId !== null).length,
			};
		});
		const updateBatch = Effect.fn("EventsService.updateBatch")(function* (
			items: ReadonlyArray<UpdateEventItem>,
			userId: UserId,
			command: LifecycleCommand,
		) {
			if (items.length > 100) {
				return yield* eventBadRequest("mutation-conflict", "Event update batch exceeds 100 items");
			}
			if (new Set(items.map((item) => item.eventId)).size !== items.length) {
				return yield* eventBadRequest(
					"mutation-conflict",
					"Event update batch contains duplicate event IDs",
				);
			}
			if (items.length === 0) {
				return { count: 0, warnings: [] as AutomationWarning[] };
			}
			yield* assertRootTransaction;
			const batchIdentity = eventMutationBatchReceiptIdentity({
				userId,
				command,
				submitted: items,
				operation: "edit",
			});
			const prior = yield* batchReplay({
				items,
				userId,
				command,
				submitted: items,
				operation: "edit",
			});
			if (prior) {
				return yield* dispatchBatchResult(prior);
			}
			const prepared: PreparedEventUpdate[] = [];
			for (const [index, item] of items.entries()) {
				const value = yield* prepareUpdate(item, userId, indexedCommand(command, index));
				if (!value) {
					const racedReplay = yield* batchReplay({
						items,
						userId,
						command,
						submitted: items,
						operation: "edit",
					});
					if (racedReplay) {
						return yield* dispatchBatchResult(racedReplay);
					}
					return yield* new EventNotFound({
						reason: { eventId: item.eventId, code: "event-not-found" },
					});
				}
				prepared.push(value);
			}
			const work = yield* transaction(
				Effect.gen(function* () {
					const aggregateReplay = yield* receipts
						.lookup(batchIdentity, EventMutationBatchReceiptResult)
						.pipe(Effect.mapError(eventReceiptError), Effect.mapError(receiptIdentityFailure));
					if (aggregateReplay) {
						return { _tag: "Replay" as const, receipt: aggregateReplay };
					}
					yield* entities.lockEntityReferencesByIds(
						prepared.flatMap(({ [preparedEventUpdate]: item }) => [
							item.before.entityId,
							...(item.before.sessionEntityId === null ? [] : [item.before.sessionEntityId]),
							item.draft.entityId,
							...(item.draft.sessionEntityId === null ? [] : [item.draft.sessionEntityId]),
						]),
					);
					yield* eventSchemas.lockCatalog();
					yield* repository.lockEventRows({ userId, eventIds: items.map((item) => item.eventId) });
					const commandInput = items;
					const mutationBatch = { command, commandInput, identity: ["events"] };
					yield* planner.prepareBatch({
						command,
						commandInput,
						scopes: [userId],
						resource: "event",
						identity: ["events"],
					});
					const writes = [];
					for (const [index, item] of prepared.entries()) {
						writes.push(yield* persist(item[preparedEventUpdate], { ...mutationBatch, index }));
					}
					const batchDispatch = yield* planner.planBatch({
						command,
						commandInput,
						resource: "event",
						identity: ["events"],
					});
					const dispatch = [...writes.flatMap((item) => item.dispatch), ...batchDispatch];
					const result = { eventIds: writes.map((item) => item.result) };
					yield* receipts.insert({ result, dispatch, identity: batchIdentity });
					return { result, dispatch, _tag: "Committed" as const };
				}),
			);
			if (work._tag === "Replay") {
				return yield* dispatchBatchResult(work.receipt);
			}
			return {
				warnings: yield* execution.dispatch(work.dispatch),
				count: work.result.eventIds.filter((eventId) => eventId !== null).length,
			};
		});
		const deleteBatch = Effect.fn("EventsService.deleteBatch")(function* (
			eventIds: ReadonlyArray<EventId>,
			userId: UserId,
			command: LifecycleCommand,
		) {
			if (eventIds.length > 100) {
				return yield* eventBadRequest("mutation-conflict", "Event delete batch exceeds 100 items");
			}
			if (new Set(eventIds).size !== eventIds.length) {
				return yield* eventBadRequest(
					"mutation-conflict",
					"Event delete batch contains duplicate event IDs",
				);
			}
			if (eventIds.length === 0) {
				return { count: 0, warnings: [] as AutomationWarning[] };
			}
			yield* assertRootTransaction;
			const items = eventIds.map((eventId) => ({ userId, eventId }));
			const batchIdentity = eventMutationBatchReceiptIdentity({
				userId,
				command,
				submitted: eventIds,
				operation: "delete",
			});
			const prior = yield* batchReplay({
				items,
				userId,
				command,
				submitted: eventIds,
				operation: "delete",
			});
			if (prior) {
				return yield* dispatchBatchResult(prior);
			}
			const prepared: Array<PreparedEventDelete | null> = [];
			for (const [index, input] of items.entries()) {
				const value = yield* prepareDelete(input, indexedCommand(command, index));
				if (!value) {
					const racedReplay = yield* batchReplay({
						items,
						userId,
						command,
						submitted: eventIds,
						operation: "delete",
					});
					if (racedReplay) {
						return yield* dispatchBatchResult(racedReplay);
					}
					prepared.push(null);
					continue;
				}
				prepared.push(value);
			}
			const work = yield* transaction(
				Effect.gen(function* () {
					const aggregateReplay = yield* receipts
						.lookup(batchIdentity, EventMutationBatchReceiptResult)
						.pipe(Effect.mapError(eventReceiptError), Effect.mapError(receiptIdentityFailure));
					if (aggregateReplay) {
						return { _tag: "Replay" as const, receipt: aggregateReplay };
					}
					yield* entities.lockEntityReferencesByIds(
						prepared.flatMap((item) =>
							item
								? [
										item[preparedEventDelete].before.entityId,
										...(item[preparedEventDelete].before.sessionEntityId === null
											? []
											: [item[preparedEventDelete].before.sessionEntityId]),
									]
								: [],
						),
					);
					yield* repository.lockEventRows({ userId, eventIds });
					const commandInput = eventIds;
					const mutationBatch = { command, commandInput, identity: ["events"] };
					const batch = prepared.some((item) => item !== null)
						? yield* planner.prepareBatch({
								command,
								commandInput,
								scopes: [userId],
								resource: "event",
								identity: ["events"],
							})
						: null;
					const writes: Array<Effect.Success<ReturnType<typeof persist>>> = [];
					for (const [index, item] of prepared.entries()) {
						const input = items[index];
						if (!input) {
							return yield* new DbError({ message: "Missing event delete batch item" });
						}
						if (item) {
							writes.push(yield* persist(item[preparedEventDelete], { ...mutationBatch, index }));
							continue;
						}
						const itemCommand = indexedCommand(command, index);
						const dispatch: ReadonlyArray<LifecycleDispatchPlan> = [];
						yield* receipts.insert({
							dispatch,
							result: { eventId: null },
							identity: eventMutationReceiptIdentity(input, itemCommand, { operation: "delete" }),
							...(batch ? { batchId: batch.id, batchIndex: index } : {}),
						});
						writes.push({ dispatch, result: null });
					}
					const batchDispatch = batch
						? yield* planner.planBatch({
								command,
								commandInput,
								resource: "event",
								identity: ["events"],
							})
						: [];
					const dispatch = [...writes.flatMap((item) => item.dispatch), ...batchDispatch];
					const result = { eventIds: writes.map((item) => item.result) };
					yield* receipts.insert({ result, dispatch, identity: batchIdentity });
					return { result, dispatch, _tag: "Committed" as const };
				}),
			).pipe(
				Effect.catchTag("DbError", (error) =>
					Effect.suspend(() => {
						const eventId = eventIds[0];
						return error.message.includes("changed while lifecycle policies ran") && eventId
							? Effect.fail(new EventStale({ reason: { eventId, code: "event-stale" } }))
							: Effect.fail(error);
					}),
				),
			);
			if (work._tag === "Replay") {
				return yield* dispatchBatchResult(work.receipt);
			}
			return {
				warnings: yield* execution.dispatch(work.dispatch),
				count: work.result.eventIds.filter((eventId) => eventId !== null).length,
			};
		});
		const moveReferences = Effect.fn("EventsService.moveReferences")(function* (
			input: UpdateEventEntityReferencesInput,
			command: LifecycleCommand,
		) {
			const mutation = { move: input, operation: "move" as const };
			const replay = yield* replaySingle(input, command, mutation);
			if (replay) {
				return replay;
			}
			const prepared = yield* prepareMoveOrDelete(input, command, input, true);
			if (!prepared) {
				return { eventId: null, warnings: [] as AutomationWarning[] };
			}
			const work =
				"_tag" in prepared
					? prepared.work
					: yield* transaction(withBatch(command, persist(prepared)));
			return { eventId: work.result, warnings: yield* execution.dispatch(work.dispatch) };
		});

		return {
			edit,
			create,
			createHttp,
			updateBatch,
			deleteBatch,
			prepareDelete,
			prepareUpdate,
			moveReferences,
			delete: deleteOne,
			getCreateOperation,
			prepareMoveReferences,
			persistPreparedDelete,
			persistPreparedUpdate,
			persistPreparedMoveReferences,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
