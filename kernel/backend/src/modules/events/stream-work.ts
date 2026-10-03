import { DbError } from "@ryot-app/contract/errors";
import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EventStreamStepInput,
	EventStreamStepOutput,
	type EventStreamWorkRequest,
} from "@ryot-app/contract/modules/events/stream-work";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import {
	AutomationExecutionId,
	EntityId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCausation } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { SandboxPluginRevision } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";

import { resolveEventCreateItemScopes } from "./event-creation";
import { EventsRepository } from "./repository";
import { EventsService } from "./service";
import { EventStreamRepository } from "./stream-repository";

const EventStreamClaim = Schema.Struct({
	id: Schema.String,
	attempt: Schema.Int,
	revision: Schema.Int,
	occurredAt: IsoUtcString,
	input: EventStreamStepInput,
	pluginPin: SandboxPluginRevision,
	processorScriptId: SandboxScriptId,
	accountGeneration: AccountGeneration,
	outputProperties: Schema.Array(Schema.String),
});

export class EventStreamProcessor extends Context.Service<
	EventStreamProcessor,
	{
		execute: (
			claim: typeof EventStreamClaim.Type,
			executionId: string,
		) => Effect.Effect<unknown, DbError>;
	}
>()("EventStreamProcessor") {}

const StepPayload = Schema.Struct({ id: Schema.String, attempt: Schema.Int });
export const EventStreamStepWorkflow = Workflow.make("EventStreamStepWorkflow", {
	error: DbError,
	payload: StepPayload,
	success: Schema.Void,
	idempotencyKey: ({ id, attempt }) => `${id}:${attempt}`,
});
export const EventStreamDispatchWorkflow = Workflow.make("EventStreamDispatchWorkflow", {
	error: DbError,
	success: Schema.Void,
	idempotencyKey: ({ requestId }) => requestId,
	payload: Schema.Struct({ id: Schema.String, requestId: Schema.String }),
});

export class EventStreamWorkService extends Context.Service<EventStreamWorkService>()(
	"EventStreamWorkService",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EventStreamRepository;
			const events = yield* EventsService;
			const eventRows = yield* EventsRepository;
			const entities = yield* EntitiesRepository;
			const eventSchemas = yield* EventSchemasRepository;
			const planner = yield* LifecyclePlanner;
			const lifecycle = yield* LifecycleExecution;
			const receipts = yield* MutationReceipts.make;
			const engine = yield* WorkflowEngine;
			const processor = yield* EventStreamProcessor;

			const request = Effect.fn("EventStreamWorkService.request")(function* (input: {
				request: typeof EventStreamWorkRequest.Type;
				processorScriptId: SandboxScriptId;
				pluginPin: SandboxPluginRevision;
				accountGeneration: AccountGeneration;
			}) {
				const scope = yield* resolveEventCreateItemScopes({
					userId: input.accountGeneration.userId,
					item: {
						properties: {},
						entityId: input.request.entityId,
						eventSchemaSlug: input.request.eventSchemaSlug,
					},
				}).pipe(
					Effect.provideService(EntitiesRepository, entities),
					Effect.provideService(EventSchemasRepository, eventSchemas),
				);
				if (
					scope.eventSchemaScope.pluginId !== input.pluginPin.id ||
					input.request.outputProperties.some(
						(name) => !Object.hasOwn(scope.eventSchemaScope.propertiesSchema.fields, name),
					)
				) {
					return yield* new DbError({
						message: "Event stream processor must own its schema and declared output properties",
					});
				}
				return yield* session.transaction(
					repository.request({
						processorScriptId: input.processorScriptId,
						accountToken: input.accountGeneration.token,
						pluginRevisionId: input.pluginPin.revisionId,
						outputProperties: input.request.outputProperties,
						pluginPin: yield* Schema.encodeUnknownEffect(JsonValue)(input.pluginPin).pipe(
							Effect.mapError(() => new DbError({ message: "Invalid processor pin" })),
						),
						key: {
							entityId: input.request.entityId,
							userId: input.accountGeneration.userId,
							eventSchemaPluginId: input.pluginPin.id,
							eventSchemaSlug: input.request.eventSchemaSlug,
						},
					}),
				);
			});

			const dispatch = Effect.fn("EventStreamWorkService.dispatch")(function* (id: string) {
				const work = yield* repository.get(id);
				if (!work || (work.status !== "queued" && work.status !== "running")) {
					return;
				}
				const attempt = work.status === "running" ? work.attempt - 1 : work.attempt;
				yield* dispatchAdmittedWorkflow(
					receipts,
					engine,
					EventStreamStepWorkflow,
					{ token: work.accountToken, userId: UserId.make(work.key.userId) },
					{
						discard: true,
						payload: { id, attempt },
						executionId: `event-stream-${id}-${attempt + 1}`,
					},
					(effect) => effect,
					(effect) => effect,
				).pipe(
					Effect.updateContext((context: Context.Context<never>) =>
						Context.omit(WorkflowInstance)(context),
					),
				);
			});

			const claim = Effect.fn("EventStreamWorkService.claim")(function* (
				payload: typeof StepPayload.Type,
			) {
				const work = yield* session.transaction(repository.claim(payload.id, payload.attempt));
				if (!work) {
					return null;
				}
				const account = yield* receipts.currentAccount(UserId.make(work.key.userId));
				if (account.token !== work.accountToken) {
					return null;
				}
				return yield* Schema.decodeUnknownEffect(EventStreamClaim)({
					id: work.id,
					attempt: work.attempt,
					pluginPin: work.pluginPin,
					accountGeneration: account,
					revision: work.streamRevision,
					outputProperties: work.outputProperties,
					occurredAt: work.updatedAt.toISOString(),
					processorScriptId: work.processorScriptId,
					input: {
						entityId: work.key.entityId,
						checkpoint: work.checkpoint,
						eventSchemaSlug: work.key.eventSchemaSlug,
						dirtyFrom: work.dirtyFrom?.toISOString() ?? null,
					},
				}).pipe(
					Effect.mapError(() => new DbError({ message: "Invalid persisted event stream claim" })),
				);
			});

			const process = Effect.fn("EventStreamWorkService.process")(function* (
				workClaim: typeof EventStreamClaim.Type,
			) {
				const executionId = `event-stream-${workClaim.id}-${workClaim.attempt}`;
				const rawOutput = yield* processor.execute(workClaim, `${executionId}-processor`);
				const output = yield* Schema.decodeUnknownEffect(EventStreamStepOutput)(rawOutput).pipe(
					Effect.mapError(
						() => new DbError({ message: "Event stream processor returned invalid output" }),
					),
				);
				if (stableStringify(output.checkpoint).length > 16_384) {
					return yield* new DbError({
						message: "Event stream checkpoint exceeds its bounded size",
					});
				}
				if (new Set(output.updates.map(({ eventId }) => eventId)).size !== output.updates.length) {
					return yield* new DbError({ message: "Event stream processor repeated an event" });
				}
				const command = yield* Schema.decodeEffect(LifecycleCommand)({
					itemIdentity: "stream-step",
					occurredAt: workClaim.occurredAt,
					accountGeneration: workClaim.accountGeneration,
					causation: {
						...rootLifecycleCausation({
							lane: "background",
							source: "bootstrap",
							executionId: AutomationExecutionId.make(executionId),
							initiator: { kind: "user", id: workClaim.accountGeneration.userId },
						}),
						eventStreamWorkId: workClaim.id,
					},
				}).pipe(
					Effect.mapError(() => new DbError({ message: "Invalid event stream lifecycle command" })),
				);
				const prepared: Array<
					NonNullable<Effect.Success<ReturnType<EventsService["Service"]["prepareUpdate"]>>>
				> = [];
				const referenceIds = new Set<string>([workClaim.input.entityId]);
				for (const item of output.updates) {
					if (
						item.patch.entityId !== undefined ||
						item.patch.sessionEntityId !== undefined ||
						[
							...(item.patch.properties?.remove ?? []),
							...Object.keys(item.patch.properties?.set ?? {}),
						].some((key) => !workClaim.outputProperties.includes(key))
					) {
						return yield* new DbError({
							message: "Event stream processor wrote outside its declared outputs",
						});
					}
					const before = yield* eventRows.getEventSnapshot({
						eventId: item.eventId,
						userId: workClaim.accountGeneration.userId,
					});
					if (
						!before ||
						before.entityId !== workClaim.input.entityId ||
						before.eventSchemaSlug !== workClaim.input.eventSchemaSlug
					) {
						return yield* new DbError({
							message: "Event stream processor targeted an event outside its stream",
						});
					}
					if (before.sessionEntityId) {
						referenceIds.add(before.sessionEntityId);
					}
					const mutation = yield* events.prepareUpdate(item, workClaim.accountGeneration.userId, {
						...command,
						itemIdentity: item.eventId,
					});
					if (mutation) {
						prepared.push(mutation);
					}
				}
				const committed = yield* session.transaction(
					Effect.gen(function* () {
						yield* entities.lockEntityReferencesByIds(
							[...referenceIds].map((id) => EntityId.make(id)),
						);
						if (
							!(yield* repository.currentClaim(workClaim.id, workClaim.attempt, workClaim.revision))
						) {
							return null;
						}
						const batch = { command, identity: ["stream-events"] };
						yield* planner.prepareBatch({
							...batch,
							resource: "event",
							scopes: [workClaim.accountGeneration.userId],
						});
						const dispatches = [];
						for (const [index, mutation] of prepared.entries()) {
							dispatches.push(
								...(yield* events.persistPreparedUpdate(mutation, { ...batch, index })).dispatch,
							);
						}
						dispatches.push(...(yield* planner.planBatch({ ...batch, resource: "event" })));
						if (
							!(yield* repository.finish(
								workClaim.id,
								workClaim.attempt,
								output.checkpoint,
								output.done,
							))
						) {
							return yield* new DbError({ message: "Event stream claim changed during commit" });
						}
						return dispatches;
					}),
				);
				if (committed) {
					yield* lifecycle.dispatch(committed);
				}
				return undefined;
			});

			const fail = Effect.fn("EventStreamWorkService.fail")(function* (
				id: string,
				attempt: number,
				message: string,
			) {
				const failed = yield* session.transaction(repository.fail(id, attempt, message));
				if (failed) {
					yield* Effect.logError("event stream processing failed").pipe(
						Effect.annotateLogs({ attempt, workId: id, reason: message }),
					);
				}
				return failed;
			});
			const reconcile = Effect.fn("EventStreamWorkService.reconcile")(function* () {
				for (const work of yield* repository.listCandidates()) {
					yield* dispatch(work.id);
				}
			});
			return { fail, claim, process, request, dispatch, reconcile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const EventStreamWorkflowDefinitionsLive = Layer.merge(
	implementWorkflow(
		EventStreamStepWorkflow,
		Effect.fn("EventStreamStepWorkflow")(function* (payload) {
			const service = yield* EventStreamWorkService;
			const claim = yield* makeActivity({
				name: "claim",
				error: DbError,
				execute: service.claim(payload),
				success: Schema.NullOr(EventStreamClaim),
			});
			if (!claim) {
				return;
			}
			yield* service
				.process(claim)
				.pipe(
					Effect.catchTag("DbError", (error) =>
						service.fail(claim.id, claim.attempt, error.message).pipe(Effect.asVoid),
					),
				);
			yield* service.dispatch(claim.id);
		}),
	),
	implementWorkflow(
		EventStreamDispatchWorkflow,
		Effect.fn("EventStreamDispatchWorkflow")(function* ({ id }) {
			yield* (yield* EventStreamWorkService).dispatch(id);
		}),
	),
);
