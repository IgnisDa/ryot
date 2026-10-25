import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { EventStreamStepInput } from "@ryot-app/contract/modules/events/stream-work";
import { EntityId, PluginId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { eq, inArray } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { BackgroundWorkService, BackgroundWorkWorkflow } from "#modules/background-work/service";
import { EventStreamRepository } from "#modules/events/stream-repository";
import { EventStreamWorkService } from "#modules/events/stream-work";
import {
	accountToken,
	backgroundJob,
	command,
	eventSchema,
	eventSchemaSlug,
	occurredAt,
	page,
	process,
	processCurrent,
	projection,
	seedStream,
	sourceState,
	StreamWorkControls,
	streamWorkTestLayer,
	userId,
} from "#modules/events/stream-work.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

layer(streamWorkTestLayer)((test) => {
	test.effect("recovers committed dispatch claims beyond the first hundred background scopes", () =>
		Effect.gen(function* () {
			const { fixture } = yield* seedStream("recovery-scopes");
			const background = yield* BackgroundWorkService;
			const session = yield* DatabaseSession;
			const controls = yield* StreamWorkControls;
			const ids = Array.from({ length: 101 }, (_, index) => `recovery-scope-${index}`);
			yield* session.transaction(
				Effect.gen(function* () {
					yield* background.lockAccount(fixture.accountGeneration);
					for (const id of ids) {
						yield* background.admit({
							id,
							key: id,
							scope: id,
							featureInput: null,
							purpose: "user-script",
							contentHash: fixture.principal.contentHash,
							accountGeneration: fixture.accountGeneration,
							execution: {
								input: null,
								lane: "background",
								resolutionMode: "exact",
								executionId: `${id}-script`,
								pluginRevision: fixture.pluginPin,
								scriptId: fixture.processorScriptId,
								subject: { userId, type: "user", accountGeneration: fixture.accountGeneration },
							},
						});
					}
				}),
			);
			const calls = (yield* controls.workflowCalls).length;
			yield* background.recover();
			const dispatched = (yield* controls.workflowCalls)
				.slice(calls)
				.filter(({ executionId }) => ids.includes(executionId));
			expect(new Set(dispatched.map(({ executionId }) => executionId))).toEqual(new Set(ids));
			expect(dispatched.every(({ inTransaction }) => !inTransaction)).toBe(true);
			const jobs = yield* session.run((db) =>
				db
					.select({ status: tables.backgroundWork.status })
					.from(tables.backgroundWork)
					.where(inArray(tables.backgroundWork.id, ids)),
			);
			expect(jobs).toHaveLength(101);
			expect(jobs.every(({ status }) => status === "running")).toBe(true);
		}),
	);

	test.effect("registers only the owned event schema and projection declaration", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const { id, fixture } = yield* seedStream("ownership");
			const stream = yield* (yield* EventStreamRepository).get(id);
			assert(stream);
			assert(eventSchema.projection);
			expect(stream.key.eventSchemaPluginId).toBe(fixture.pluginId);
			expect(stream.pluginPin).toEqual({ ...fixture.pluginPin, writeContext: fixture.principal });
			expect(stream.outputSchema).toEqual(eventSchema.projection.propertiesSchema);

			const wrongOwner = yield* Effect.exit(
				service.request({
					accountGeneration: fixture.accountGeneration,
					processorScriptId: SandboxScriptId.make("foreign-processor"),
					pluginPin: { ...fixture.pluginPin, id: PluginId.make("foreign-plugin") },
					command: { ...command("foreign-request"), writeContext: fixture.principal },
					request: { eventSchemaSlug, entityId: EntityId.make("stream-ownership-record") },
				}),
			);
			assertExitFails(
				wrongOwner,
				new DbError({
					message: "Event stream request requires its exact persisted execution authority",
				}),
			);

			const mismatchedProcessor = yield* Effect.exit(
				service.request({
					pluginPin: fixture.pluginPin,
					accountGeneration: fixture.accountGeneration,
					processorScriptId: SandboxScriptId.make("mismatched-processor"),
					request: { eventSchemaSlug, entityId: EntityId.make("stream-ownership-record") },
					command: { ...command("mismatched-processor-request"), writeContext: fixture.principal },
				}),
			);
			assertExitFails(
				mismatchedProcessor,
				new DbError({
					message: "Event stream processor does not belong to the exact admitted plugin revision",
				}),
			);
		}),
	);

	test.effect("publishes a page, settles its job, and admits a fresh continuation", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const background = yield* BackgroundWorkService;
			const { id, eventId } = yield* seedStream("page");
			const sourceBefore = yield* sourceState(eventId);
			assert(sourceBefore);
			const before = yield* streams.get(id);
			assert(before?.currentJobId);
			yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 9, "next-page")));

			const job = yield* processCurrent(id);
			expect(job.purpose).toBe("event-projection");
			expect(job.execution.subject.type).toBe("projection");
			expect(job.id).toBe(before.currentJobId);
			expect(yield* backgroundJob(job.id)).toEqual({ error: null, status: "succeeded" });

			const sourceAfter = yield* sourceState(eventId);
			assert(sourceAfter);
			expect(sourceAfter.properties).toEqual({ rating: 1 });
			expect(sourceAfter.occurredAt).toEqual(sourceBefore.occurredAt);
			expect(sourceAfter.createdAt).toEqual(sourceBefore.createdAt);
			expect(sourceAfter.updatedAt).toEqual(sourceBefore.updatedAt);
			expect(sourceAfter.revision).toBe(sourceBefore.revision);
			expect(yield* projection(eventId)).toEqual({ properties: { score: 9 } });
			const checkpointed = yield* streams.get(id);
			assert(checkpointed);
			expect(checkpointed.checkpoint).toEqual({ cursor: "next-page" });
			expect(checkpointed.status).toBe("queued");
			expect(checkpointed.dirtyFrom).toBeNull();
			expect(checkpointed.completedRevision).toBeNull();
			expect(checkpointed.step).toBe(before.step + 1);
			assert(checkpointed.currentJobId);
			expect(checkpointed.currentJobId).not.toBe(job.id);
			yield* background.dispatch(checkpointed.currentJobId);
			const nextJob = yield* background.start(checkpointed.currentJobId);
			assert(nextJob);
			expect(nextJob.execution.subject.type).toBe("projection");
			expect(
				(yield* Schema.decodeUnknownEffect(EventStreamStepInput)(nextJob.execution.input))
					.checkpoint,
			).toEqual({ cursor: "next-page" });
			expect((yield* controls.processorCalls).at(-1)).toEqual({ id, jobId: job.id });
		}),
	);

	test.effect("advances a multi-step stream to done through scope handoff", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const background = yield* BackgroundWorkService;
			const { id, eventId } = yield* seedStream("multi-step");
			yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 5, "second")));
			const first = yield* processCurrent(id);
			const continued = yield* streams.get(id);
			assert(continued?.currentJobId);
			expect(yield* backgroundJob(continued.currentJobId)).toEqual({
				error: null,
				status: "queued",
			});

			yield* background.dispatch(first.id);
			expect(yield* backgroundJob(continued.currentJobId)).toEqual({
				error: null,
				status: "running",
			});

			yield* controls.setProcessor(id, () =>
				Effect.succeed({ ...page(eventId, 6, "last"), done: true }),
			);
			const last = yield* processCurrent(id);
			expect(last.id).toBe(continued.currentJobId);
			const finished = yield* streams.get(id);
			expect(finished?.status).toBe("succeeded");
			expect(yield* projection(eventId)).toEqual({ properties: { score: 6 } });
			expect(yield* backgroundJob(last.id)).toEqual({ error: null, status: "succeeded" });
		}),
	);

	test.effect("rolls back a failed projection publication and retries the page", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const { id, eventId } = yield* seedStream("retry");
			const sourceBefore = yield* sourceState(eventId);
			assert(sourceBefore);
			yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 8, "retry-page")));
			const before = yield* streams.get(id);
			assert(before?.currentJobId);
			yield* controls.failProjectionFor(id);

			assertExitFails(
				yield* Effect.exit(processCurrent(id)),
				new DbError({ message: "Injected projection failure" }),
			);
			const rolledBack = yield* sourceState(eventId);
			assert(rolledBack);
			expect(rolledBack.properties).toEqual({ rating: 1 });
			expect(rolledBack.occurredAt).toEqual(sourceBefore.occurredAt);
			expect(rolledBack.createdAt).toEqual(sourceBefore.createdAt);
			expect(rolledBack.updatedAt).toEqual(sourceBefore.updatedAt);
			expect(rolledBack.revision).toBe(sourceBefore.revision);
			expect(yield* projection(eventId)).toBeNull();
			const pending = yield* streams.get(id);
			assert(pending);
			expect(pending.status).toBe("running");
			expect(pending.checkpoint).toBeNull();
			expect(pending.currentJobId).toBe(before.currentJobId);
			expect(pending.step).toBe(before.step);
			expect(yield* backgroundJob(before.currentJobId)).toEqual({ error: null, status: "running" });

			yield* controls.clearProjectionFailureFor(id);
			const retried = yield* processCurrent(id);
			expect(retried.id).toBe(before.currentJobId);
			expect(yield* backgroundJob(retried.id)).toEqual({ error: null, status: "succeeded" });

			const sourceAfter = yield* sourceState(eventId);
			assert(sourceAfter);
			expect(sourceAfter.properties).toEqual({ rating: 1 });
			expect(sourceAfter.occurredAt).toEqual(sourceBefore.occurredAt);
			expect(sourceAfter.createdAt).toEqual(sourceBefore.createdAt);
			expect(sourceAfter.updatedAt).toEqual(sourceBefore.updatedAt);
			expect(sourceAfter.revision).toBe(sourceBefore.revision);
			expect(yield* projection(eventId)).toEqual({ properties: { score: 8 } });
			const finished = yield* streams.get(id);
			assert(finished);
			expect(finished.checkpoint).toEqual({ cursor: "retry-page" });
			expect(finished.status).toBe("queued");
			expect(finished.currentJobId).not.toBe(retried.id);
		}),
	);

	test.effect("retries a failed step with a new job at the same dependency revision", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const controls = yield* StreamWorkControls;
			const background = yield* BackgroundWorkService;
			const streams = yield* EventStreamRepository;
			const source = yield* seedStream("failed-job-retry");
			const before = yield* streams.get(source.id);
			assert(before?.currentJobId);
			yield* background.finish(before.currentJobId, "failed", "Processor failed");
			yield* service.request({
				pluginPin: source.fixture.pluginPin,
				accountGeneration: source.fixture.accountGeneration,
				processorScriptId: source.fixture.processorScriptId,
				request: { eventSchemaSlug, entityId: source.entityId },
				command: { ...command("retry-failed-job"), writeContext: source.fixture.principal },
			});
			const retried = yield* streams.get(source.id);
			expect(retried?.currentJobId).not.toBe(before.currentJobId);
			expect(retried?.streamRevision).toBe(before.streamRevision);
			yield* controls.setProcessor(source.id, () =>
				Effect.succeed({ ...page(source.eventId, 8, "retried"), done: true }),
			);
			yield* processCurrent(source.id);
			expect(yield* projection(source.eventId)).toEqual({ properties: { score: 8 } });
		}),
	);

	test.effect("dispatches coalesced stream steps independently of ambient workflow parents", () =>
		Effect.gen(function* () {
			const background = yield* BackgroundWorkService;
			const controls = yield* StreamWorkControls;
			const { id } = yield* seedStream("parent-independent");
			const streams = yield* EventStreamRepository;
			const stream = yield* streams.get(id);
			assert(stream?.currentJobId);
			const workflowCallsBefore = yield* controls.workflowCalls;
			const parentA = WorkflowInstance.initial(BackgroundWorkWorkflow, "stream-parent-a");
			const parentB = WorkflowInstance.initial(BackgroundWorkWorkflow, "stream-parent-b");
			yield* background
				.dispatch(stream.currentJobId)
				.pipe(Effect.provideService(WorkflowInstance, parentA));
			yield* background
				.dispatch(stream.currentJobId)
				.pipe(Effect.provideService(WorkflowInstance, parentB));

			const dispatches = (yield* controls.workflowCalls).slice(workflowCallsBefore.length);
			expect(dispatches).toHaveLength(2);
			expect(dispatches.map(({ parentExecutionId }) => parentExecutionId)).toEqual([null, null]);
			expect(dispatches.map(({ executionId }) => executionId)).toEqual([
				stream.currentJobId,
				stream.currentJobId,
			]);
		}),
	);

	test.effect(
		"keeps a settled job replay from duplicating a committed projection or continuation",
		() =>
			Effect.gen(function* () {
				const service = yield* EventStreamWorkService;
				const controls = yield* StreamWorkControls;
				const streams = yield* EventStreamRepository;
				const { id, eventId } = yield* seedStream("replay");
				const sourceBefore = yield* sourceState(eventId);
				assert(sourceBefore);
				const controlsBefore = yield* controls.processorCalls;
				yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 7, "replay-page")));

				const job = yield* processCurrent(id);
				const afterFirst = yield* streams.get(id);
				assert(afterFirst?.currentJobId);
				yield* process(job);
				yield* service.reconcile();
				yield* service.reconcile();

				const sourceAfter = yield* sourceState(eventId);
				assert(sourceAfter);
				expect(sourceAfter.properties).toEqual({ rating: 1 });
				expect(sourceAfter.occurredAt).toEqual(sourceBefore.occurredAt);
				expect(sourceAfter.createdAt).toEqual(sourceBefore.createdAt);
				expect(sourceAfter.updatedAt).toEqual(sourceBefore.updatedAt);
				expect(sourceAfter.revision).toBe(sourceBefore.revision);
				expect(yield* projection(eventId)).toEqual({ properties: { score: 7 } });
				const work = yield* streams.get(id);
				assert(work);
				expect(work.checkpoint).toEqual({ cursor: "replay-page" });
				expect(work.currentJobId).toBe(afterFirst.currentJobId);
				expect(work.streamRevision).toBe(afterFirst.streamRevision);
				expect(work.completedRevision).toBeNull();
				expect((yield* controls.processorCalls).slice(controlsBefore.length)).toEqual([
					{ id, jobId: job.id },
					{ id, jobId: job.id },
				]);
			}),
	);

	test.effect(
		"rejects foreign events, undeclared properties, duplicate IDs, oversized pages, and malformed output",
		() =>
			Effect.gen(function* () {
				const controls = yield* StreamWorkControls;
				const { id, eventId } = yield* seedStream("invalid-output");
				const foreign = yield* seedStream("foreign-output");
				const repeated = page(eventId, 4, "duplicate");
				const tooMany = {
					done: false,
					checkpoint: { cursor: "too-many" },
					updates: Array.from({ length: 101 }, () => repeated.updates[0]),
				};
				const malformed = { done: false, updates: [], checkpoint: undefined };
				const invalidOutputs: ReadonlyArray<{ output: unknown; message: string }> = [
					{
						message: "Projection output targeted an event outside its stream",
						output: {
							...page(eventId, 3, "foreign"),
							updates: [{ ...repeated.updates[0], eventId: foreign.eventId }],
						},
					},
					{
						message: "Projection output does not match its declared schema",
						output: {
							...page(eventId, 3, "undeclared"),
							updates: [{ eventId, properties: { other: 3 } }],
						},
					},
					{
						message: "Event stream processor repeated an event",
						output: { ...repeated, updates: [repeated.updates[0], repeated.updates[0]] },
					},
					{ output: tooMany, message: "Event stream processor returned invalid output" },
					{ output: malformed, message: "Event stream processor returned invalid output" },
					{
						message: "Event stream checkpoint exceeds its bounded size",
						output: { done: false, updates: [], checkpoint: "x".repeat(16_385) },
					},
					{
						message: "Event stream checkpoint exceeds its bounded size",
						output: { done: false, updates: [], checkpoint: "界".repeat(6_000) },
					},
				];
				for (const { output, message } of invalidOutputs) {
					yield* controls.setProcessor(id, () => Effect.succeed(output));
					assertExitFails(yield* Effect.exit(processCurrent(id)), new DbError({ message }));
				}
			}),
	);

	test.effect("rejects publication when the account is disabled during processor execution", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const session = yield* DatabaseSession;
			const source = yield* seedStream("disabled-publish");
			yield* controls.setProcessor(source.id, () =>
				session
					.run((db) =>
						db
							.update(tables.user)
							.set({ disabledAt: occurredAt })
							.where(eq(tables.user.id, userId)),
					)
					.pipe(Effect.as({ ...page(source.eventId, 99, "disabled"), done: true })),
			);
			yield* Effect.gen(function* () {
				assertExitFails(
					yield* Effect.exit(processCurrent(source.id)),
					new DbError({ message: "Current domain write account authority is unavailable" }),
				);
				expect(yield* projection(source.eventId)).toBeNull();
			}).pipe(
				Effect.ensuring(
					session
						.run((db) =>
							db.update(tables.user).set({ disabledAt: null }).where(eq(tables.user.id, userId)),
						)
						.pipe(Effect.orDie),
				),
			);
		}),
	);

	test.effect("blocks dispatch after an account generation is retired", () =>
		Effect.gen(function* () {
			const background = yield* BackgroundWorkService;
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const session = yield* DatabaseSession;
			const { id } = yield* seedStream("retired-account");
			const stream = yield* streams.get(id);
			assert(stream?.currentJobId);
			const workflowCallsBefore = yield* controls.workflowCalls;
			yield* session.run((db) =>
				db
					.update(tables.user)
					.set({ accountGeneration: "retired-generation" })
					.where(eq(tables.user.id, userId)),
			);

			assertExitFails(
				yield* Effect.exit(background.dispatch(stream.currentJobId)),
				new DbError({ message: "Mutation command belongs to a retired account" }),
			);
			expect(yield* controls.workflowCalls).toHaveLength(workflowCallsBefore.length);
			yield* session.run((db) =>
				db
					.update(tables.user)
					.set({ accountGeneration: accountToken })
					.where(eq(tables.user.id, userId)),
			);
		}),
	);
});
