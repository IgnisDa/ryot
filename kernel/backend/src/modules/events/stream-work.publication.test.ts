import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { EventStreamBatchInput } from "@ryot-app/contract/modules/events/stream-work";
import { EntityId, PluginId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { eq, inArray } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { BackgroundWorkService, BackgroundWorkWorkflow } from "#modules/background-work/service";
import { EventsService } from "#modules/events/service";
import { streamState } from "#modules/events/stream-repository.test-support";
import { EventStreamWorkService } from "#modules/events/stream-work";
import {
	accountToken,
	activeJob,
	backgroundJob,
	command,
	eventSchema,
	eventSchemaSlug,
	occurredAt,
	page,
	prepare,
	processNext,
	projection,
	publish,
	seedStream,
	sourceState,
	startJob,
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
			const stream = yield* streamState(id);
			assert(eventSchema.projection);
			expect(stream?.pluginPin).toMatchObject({
				id: fixture.pluginId,
				revisionId: fixture.pluginPin.revisionId,
				writeContext: { subject: { userId, type: "projection" } },
			});
			expect(stream?.outputSchema).toEqual(eventSchema.projection.propertiesSchema);

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

	test.effect("publishes a batch, settles its job, and admits a continuation", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const { id, eventId } = yield* seedStream("page");
			const sourceBefore = yield* sourceState(eventId);
			yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 9, "next-page")));

			const job = yield* processNext();
			expect(job.purpose).toBe("event-projection");
			expect(job.execution.subject.type).toBe("projection");
			expect(yield* backgroundJob(job.id)).toEqual({ error: null, status: "succeeded" });
			expect(yield* sourceState(eventId)).toEqual(sourceBefore);
			expect(yield* projection(eventId)).toEqual({ properties: { score: 9 } });
			expect(yield* streamState(id)).toMatchObject({
				dirtyFrom: null,
				currentJobId: job.id,
				completedRevision: null,
				checkpoint: { cursor: "next-page" },
			});
			const [continuation, ...others] = yield* activeJob();
			expect(others).toEqual([]);
			expect(continuation).toMatchObject({ status: "queued" });
			const next = yield* prepare(yield* startJob());
			expect(next.id).toBe(continuation?.id);
			const input = yield* Schema.decodeEffect(EventStreamBatchInput)(next.execution.input);
			expect(input.streams).toEqual([
				{ dirtyFrom: null, entityId: "stream-page-record", checkpoint: { cursor: "next-page" } },
			]);
			yield* controls.setProcessor(id, () =>
				Effect.succeed({ ...page(eventId, 10, "last"), done: true }),
			);
			yield* publish(next);
			expect(yield* activeJob()).toEqual([]);
		}),
	);

	test.effect("advances a multi-step stream to done through scope handoff", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const background = yield* BackgroundWorkService;
			const { id, eventId } = yield* seedStream("multi-step");
			yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 5, "second")));
			const first = yield* processNext();
			const [continued] = yield* activeJob();
			assert(continued);
			expect(continued.status).toBe("queued");

			yield* background.dispatch(first.id);
			expect(yield* backgroundJob(continued.id)).toEqual({ error: null, status: "running" });

			yield* controls.setProcessor(id, () =>
				Effect.succeed({ ...page(eventId, 6, "last"), done: true }),
			);
			const last = yield* processNext();
			expect(last.id).toBe(continued.id);
			const finished = yield* streamState(id);
			expect(finished?.status).toBe("succeeded");
			expect(finished?.completedRevision).toBe(finished?.streamRevision);
			expect(yield* projection(eventId)).toEqual({ properties: { score: 6 } });
		}),
	);

	test.effect("rolls back a failed projection publication and retries the batch", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const { id, eventId } = yield* seedStream("retry");
			const sourceBefore = yield* sourceState(eventId);
			yield* controls.setProcessor(id, () =>
				Effect.succeed({ ...page(eventId, 8, "retry-page"), done: true }),
			);
			yield* controls.failProjectionFor(id);
			const job = yield* prepare(yield* startJob());

			assertExitFails(
				yield* Effect.exit(publish(job)),
				new DbError({ message: "Injected projection failure" }),
			);
			expect(yield* sourceState(eventId)).toEqual(sourceBefore);
			expect(yield* projection(eventId)).toBeNull();
			expect(yield* streamState(id)).toMatchObject({
				checkpoint: null,
				status: "running",
				currentJobId: job.id,
			});

			yield* controls.clearProjectionFailureFor(id);
			yield* publish(job);
			expect(yield* backgroundJob(job.id)).toEqual({ error: null, status: "succeeded" });
			expect(yield* sourceState(eventId)).toEqual(sourceBefore);
			expect(yield* projection(eventId)).toEqual({ properties: { score: 8 } });
			expect(yield* activeJob()).toEqual([]);
		}),
	);

	test.effect("retries a failed stream with a new job at the same revision", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const controls = yield* StreamWorkControls;
			const background = yield* BackgroundWorkService;
			const source = yield* seedStream("failed-job-retry");
			const failed = yield* prepare(yield* startJob());
			yield* background.finish({ userId, id: failed.id }, "failed", "Processor failed");
			const before = yield* streamState(source.id);
			expect(before).toMatchObject({ status: "failed", currentJobId: failed.id });
			yield* service.request({
				pluginPin: source.fixture.pluginPin,
				accountGeneration: source.fixture.accountGeneration,
				processorScriptId: source.fixture.processorScriptId,
				request: { eventSchemaSlug, entityId: source.entityId },
				command: { ...command("retry-failed-job"), writeContext: source.fixture.principal },
			});
			expect(yield* streamState(source.id)).toMatchObject({
				currentJobId: null,
				streamRevision: before?.streamRevision,
			});
			yield* controls.setProcessor(source.id, () =>
				Effect.succeed({ ...page(source.eventId, 8, "retried"), done: true }),
			);
			const retried = yield* processNext();
			expect(retried.id).not.toBe(failed.id);
			expect(yield* projection(source.eventId)).toEqual({ properties: { score: 8 } });
		}),
	);

	test.effect("dispatches projection jobs independently of ambient workflow parents", () =>
		Effect.gen(function* () {
			const background = yield* BackgroundWorkService;
			const controls = yield* StreamWorkControls;
			yield* seedStream("parent-independent");
			const running = (yield* activeJob()).find(({ status }) => status === "running");
			assert(running);
			const workflowCallsBefore = yield* controls.workflowCalls;
			const parentA = WorkflowInstance.initial(BackgroundWorkWorkflow, "stream-parent-a");
			const parentB = WorkflowInstance.initial(BackgroundWorkWorkflow, "stream-parent-b");
			yield* background.dispatch(running.id).pipe(Effect.provideService(WorkflowInstance, parentA));
			yield* background.dispatch(running.id).pipe(Effect.provideService(WorkflowInstance, parentB));

			const dispatches = (yield* controls.workflowCalls).slice(workflowCallsBefore.length);
			expect(dispatches.map(({ parentExecutionId }) => parentExecutionId)).toEqual([null, null]);
			expect(dispatches.map(({ executionId }) => executionId)).toEqual([running.id, running.id]);
			yield* processNext();
		}),
	);

	test.effect("keeps a settled job replay from duplicating a committed batch or continuation", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const controls = yield* StreamWorkControls;
			const { id, eventId } = yield* seedStream("replay");
			const sourceBefore = yield* sourceState(eventId);
			const callsBefore = yield* controls.processorCalls;
			yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 7, "replay-page")));

			const job = yield* prepare(yield* startJob());
			yield* publish(job);
			const afterFirst = yield* streamState(id);
			const continuation = yield* activeJob();
			yield* publish(job);
			yield* service.reconcile();
			yield* service.reconcile();

			expect(yield* sourceState(eventId)).toEqual(sourceBefore);
			expect(yield* projection(eventId)).toEqual({ properties: { score: 7 } });
			expect(yield* streamState(id)).toEqual(afterFirst);
			expect(yield* activeJob()).toEqual(continuation);
			expect(
				(yield* controls.processorCalls).slice(callsBefore.length).filter((call) => call.id === id),
			).toEqual([
				{ id, jobId: job.id },
				{ id, jobId: job.id },
			]);
			yield* controls.setProcessor(id, () =>
				Effect.succeed({ ...page(eventId, 7, "replay-done"), done: true }),
			);
			yield* processNext();
		}),
	);

	test.effect(
		"publishes current streams and leaves a stream made stale during the batch dirty",
		() =>
			Effect.gen(function* () {
				const controls = yield* StreamWorkControls;
				const events = yield* EventsService;
				const left = yield* seedStream("stale-left");
				const right = yield* seedStream("stale-right");
				const job = yield* prepare(yield* startJob());
				yield* controls.setProcessor(left.id, () =>
					events
						.edit(
							{ eventId: left.eventId, patch: { properties: { remove: [], set: { rating: 2 } } } },
							userId,
							command("stale-left-edit"),
						)
						.pipe(Effect.orDie, Effect.as({ ...page(left.eventId, 3, "stale"), done: true })),
				);
				yield* controls.setProcessor(right.id, () =>
					Effect.succeed({ ...page(right.eventId, 4, "current"), done: true }),
				);
				yield* publish(job);

				expect(yield* projection(right.eventId)).toEqual({ properties: { score: 4 } });
				expect(yield* projection(left.eventId)).toBeNull();
				const stale = yield* streamState(left.id);
				expect(stale).toMatchObject({ currentJobId: null, completedRevision: null });
				const queued = yield* activeJob();
				expect(queued.map(({ status }) => status)).toEqual(["queued"]);

				yield* controls.setProcessor(left.id, () =>
					Effect.succeed({ ...page(left.eventId, 5, "fresh"), done: true }),
				);
				const next = yield* processNext();
				expect(next.id).toBe(queued[0]?.id);
				expect(yield* projection(left.eventId)).toEqual({ properties: { score: 5 } });
			}),
	);

	test.effect(
		"rejects foreign events, undeclared properties, duplicates, unclaimed streams, oversized batches, and malformed output",
		() =>
			Effect.gen(function* () {
				const controls = yield* StreamWorkControls;
				const foreign = yield* seedStream("foreign-output");
				const { id, eventId } = yield* seedStream("invalid-output");
				const job = yield* prepare(yield* startJob());
				const repeated = page(eventId, 4, "duplicate");
				const update = { eventId, properties: { score: 4 } };
				const invalidOutputs: ReadonlyArray<{ output: unknown; message: string }> = [
					{
						message: "Projection output targeted an event outside its stream",
						output: {
							...page(eventId, 3, "foreign"),
							updates: [{ ...update, eventId: foreign.eventId }],
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
						output: { ...repeated, updates: [update, update] },
						message: "Event stream processor repeated an event",
					},
					{
						message: "Event stream processor returned too many updates",
						output: { ...repeated, updates: Array.from({ length: 1001 }, () => update) },
					},
					{
						output: { ...repeated, entityId: foreign.entityId },
						message: "Event stream processor must return each claimed stream once",
					},
					{
						message: "Event stream processor returned invalid output",
						output: { done: false, updates: [], checkpoint: undefined },
					},
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
					assertExitFails(yield* Effect.exit(publish(job)), new DbError({ message }));
				}
				expect(yield* projection(eventId)).toBeNull();
				yield* controls.setProcessor(id, () => Effect.succeed({ ...repeated, done: true }));
				yield* publish(job);
				expect(yield* projection(eventId)).toEqual({ properties: { score: 4 } });
			}),
	);

	test.effect("rejects publication when the account is disabled during processor execution", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const session = yield* DatabaseSession;
			const source = yield* seedStream("disabled-publish");
			const job = yield* prepare(yield* startJob());
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
					yield* Effect.exit(publish(job)),
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
			yield* controls.setProcessor(source.id, () =>
				Effect.succeed({ ...page(source.eventId, 98, "enabled"), done: true }),
			);
			yield* publish(job);
			expect(yield* projection(source.eventId)).toEqual({ properties: { score: 98 } });
		}),
	);

	test.effect("blocks dispatch after an account generation is retired", () =>
		Effect.gen(function* () {
			const background = yield* BackgroundWorkService;
			const controls = yield* StreamWorkControls;
			const session = yield* DatabaseSession;
			yield* seedStream("retired-account");
			const [head] = yield* activeJob();
			assert(head);
			const workflowCallsBefore = yield* controls.workflowCalls;
			yield* session.run((db) =>
				db
					.update(tables.user)
					.set({ accountGeneration: "retired-generation" })
					.where(eq(tables.user.id, userId)),
			);

			assertExitFails(
				yield* Effect.exit(background.dispatch(head.id)),
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
