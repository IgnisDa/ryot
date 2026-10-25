import { assert, expect, layer } from "@effect/vitest";
import { EntityId, EventId, UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import type { BackgroundWorkInput } from "#modules/background-work/model";
import { BackgroundWorkService } from "#modules/background-work/service";
import { EventMutations, eventPolicyItems } from "#modules/events/mutations";
import {
	projectionDependencyTargets,
	projectionSources,
} from "#modules/events/projection-dependencies";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { EventStreamRepository, type StreamKey } from "#modules/events/stream-repository";
import { EventStreamWorkService } from "#modules/events/stream-work";
import {
	adjustmentSchemaSlug,
	backgroundJob,
	command,
	coordinationSchemaSlug,
	currentJob,
	entitySchemaSlug,
	eventSchemaSlug,
	occurredAt,
	page,
	process,
	processCurrent,
	processorScriptSlug,
	projection,
	runBackgroundJob,
	seedAdjustment,
	seedRetainedTargets,
	seedStream,
	sourceState,
	StreamWorkControls,
	streamWorkTestLayer,
	summarySchemaSlug,
	userId,
} from "#modules/events/stream-work.test-support";
import { ProjectionBindings } from "#modules/scripts/executions/projection-bindings";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

layer(streamWorkTestLayer)((test) => {
	test.effect("reuses the queued stream job across invalidations and runs its current claim", () =>
		Effect.gen(function* () {
			const events = yield* EventsService;
			const streams = yield* EventStreamRepository;
			const session = yield* DatabaseSession;
			const source = yield* seedStream("queued-reuse");
			const initial = yield* streams.get(source.id);
			assert(initial?.currentJobId);
			const running = initial.currentJobId;
			expect(yield* backgroundJob(running)).toEqual({ error: null, status: "running" });
			const jobs: Array<null | string> = [];
			for (const rating of [2, 3, 4]) {
				yield* events.edit(
					{ eventId: source.eventId, patch: { properties: { remove: [], set: { rating } } } },
					userId,
					command(`queued-reuse-${rating}`),
				);
				jobs.push((yield* streams.get(source.id))?.currentJobId ?? null);
			}
			const [queued] = jobs;
			assert(queued);
			expect(queued).not.toBe(running);
			expect(jobs).toEqual([queued, queued, queued]);
			const invalidated = yield* streams.get(source.id);
			assert(invalidated);
			expect(invalidated.streamRevision).toBe(initial.streamRevision + 3);
			expect(
				yield* session.run((db) =>
					db
						.select({ id: tables.backgroundWork.id })
						.from(tables.backgroundWork)
						.where(
							and(
								eq(tables.backgroundWork.status, "queued"),
								eq(tables.backgroundWork.scope, source.entityId),
								eq(tables.backgroundWork.purpose, "event-projection"),
							),
						),
				),
			).toEqual([{ id: queued }]);
			const executed: Array<{ id: string; revision: number }> = [];
			const execute = (job: BackgroundWorkInput) =>
				Effect.gen(function* () {
					const claim = yield* Schema.decodeUnknownEffect(Schema.Struct({ revision: Schema.Int }))(
						job.featureInput,
					).pipe(Effect.orDie);
					executed.push({ id: job.id, revision: claim.revision });
					return { ...page(source.eventId, 4, "current"), done: true };
				});
			yield* runBackgroundJob(running, execute);
			expect(executed).toEqual([]);
			expect(yield* backgroundJob(running)).toEqual({ error: null, status: "succeeded" });
			expect(yield* projection(source.eventId)).toBeNull();
			yield* runBackgroundJob(queued, execute);
			expect(executed).toEqual([{ id: queued, revision: invalidated.streamRevision }]);
			expect(yield* backgroundJob(queued)).toEqual({ error: null, status: "succeeded" });
			expect(yield* projection(source.eventId)).toEqual({ properties: { score: 4 } });
			const completed = yield* streams.get(source.id);
			assert(completed);
			expect(completed.completedRevision).toBe(invalidated.streamRevision);
		}),
	);

	test.effect("preserves another stream's queued claim and reuses the current queued claim", () =>
		Effect.gen(function* () {
			const source = yield* seedStream("coalesced-sibling");
			const service = yield* EventStreamWorkService;
			const streams = yield* EventStreamRepository;
			const events = yield* EventsService;
			const binding = yield* (yield* ProjectionBindings).resolve({
				userId,
				scriptSlug: processorScriptSlug,
				pluginId: source.fixture.pluginId,
			});
			assert(binding);
			const request = {
				pluginPin: binding.pluginPin,
				accountGeneration: binding.accountGeneration,
				processorScriptId: source.fixture.processorScriptId,
				command: { ...command("coalesced-sibling-request"), writeContext: binding.principal },
			};
			const siblingId = yield* service.request({
				...request,
				request: { entityId: source.entityId, eventSchemaSlug: summarySchemaSlug },
			});
			const sibling = yield* streams.get(siblingId);
			assert(sibling?.currentJobId);
			expect(yield* backgroundJob(sibling.currentJobId)).toEqual({ error: null, status: "queued" });
			for (const rating of [2, 3]) {
				yield* events.edit(
					{ eventId: source.eventId, patch: { properties: { remove: [], set: { rating } } } },
					userId,
					command(`coalesced-sibling-edit-${rating}`),
				);
			}
			const current = yield* streams.get(source.id);
			assert(current?.currentJobId);
			yield* service.request({
				...request,
				request: { eventSchemaSlug, entityId: source.entityId },
			});
			expect((yield* streams.get(source.id))?.currentJobId).toBe(current.currentJobId);
			expect(yield* backgroundJob(current.currentJobId)).toEqual({ error: null, status: "queued" });
			expect((yield* streams.get(siblingId))?.currentJobId).toBe(sibling.currentJobId);
			expect(yield* backgroundJob(sibling.currentJobId)).toEqual({ error: null, status: "queued" });
		}),
	);

	test.effect(
		"keeps the publication fence when a source changes after projection preparation",
		() =>
			Effect.gen(function* () {
				const events = yield* EventsService;
				const streams = yield* EventStreamRepository;
				const source = yield* seedStream("prepared-then-stale");
				const job = yield* currentJob(source.id);
				const executed: string[] = [];
				yield* runBackgroundJob(job.id, (input) =>
					Effect.gen(function* () {
						executed.push(input.id);
						yield* events
							.edit(
								{
									eventId: source.eventId,
									patch: { properties: { remove: [], set: { rating: 2 } } },
								},
								userId,
								command("prepared-then-stale-edit"),
							)
							.pipe(Effect.orDie);
						return { ...page(source.eventId, 9, "stale"), done: true };
					}),
				);
				expect(executed).toEqual([job.id]);
				expect(yield* projection(source.eventId)).toBeNull();
				expect(yield* backgroundJob(job.id)).toEqual({ error: null, status: "succeeded" });
				const next = yield* streams.get(source.id);
				assert(next?.currentJobId);
				expect(next.currentJobId).not.toBe(job.id);
				expect(next.completedRevision).toBeNull();
				expect(yield* backgroundJob(next.currentJobId)).toEqual({ error: null, status: "running" });
			}),
	);

	test.effect(
		"does not commit a processor result after an ordinary source edit invalidates its claim",
		() =>
			Effect.gen(function* () {
				const events = yield* EventsRepository;
				const eventService = yield* EventsService;
				const streams = yield* EventStreamRepository;
				const controls = yield* StreamWorkControls;
				const { id, eventId } = yield* seedStream("concurrent-edit");
				const before = yield* streams.get(id);
				assert(before);
				yield* controls.setProcessor(id, () =>
					Effect.gen(function* () {
						yield* eventService
							.edit(
								{ eventId, patch: { properties: { remove: [], set: { rating: 2 } } } },
								userId,
								command("ordinary-source-edit"),
							)
							.pipe(Effect.orDie);
						return page(eventId, 9, "stale-result");
					}),
				);

				const job = yield* processCurrent(id);

				const source = yield* events.getEventSnapshot({ userId, eventId });
				assert(source);
				expect(source.snapshot.properties).toEqual({ rating: 2 });
				const work = yield* streams.get(id);
				assert(work);
				expect(work.status).toBe("queued");
				expect(work.checkpoint).toBeNull();
				expect(work.streamRevision).toBeGreaterThan(before.streamRevision);
				expect(work.currentJobId).not.toBe(job.id);
			}),
	);

	test.effect("does not commit a stale processor result after its source event is deleted", () =>
		Effect.gen(function* () {
			const eventService = yield* EventsService;
			const events = yield* EventsRepository;
			const streams = yield* EventStreamRepository;
			const controls = yield* StreamWorkControls;
			const { id, eventId } = yield* seedStream("deleted-source");
			const before = yield* streams.get(id);
			assert(before);
			yield* controls.setProcessor(id, () =>
				Effect.gen(function* () {
					yield* eventService
						.delete({ userId, eventId }, command("delete-stream-source"))
						.pipe(Effect.orDie);
					return { done: false, updates: [], checkpoint: { cursor: "deleted" } };
				}),
			);

			const job = yield* processCurrent(id);

			expect(yield* events.getEventSnapshot({ userId, eventId })).toBeNull();
			const work = yield* streams.get(id);
			assert(work);
			expect(work.status).toBe("queued");
			expect(work.checkpoint).toBeNull();
			expect(work.streamRevision).toBeGreaterThan(before.streamRevision);
			expect(work.currentJobId).not.toBe(job.id);
		}),
	);

	test.effect("fences sibling edits and deletions without changing the output source", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const service = yield* EventStreamWorkService;
			const events = yield* EventsService;
			const background = yield* BackgroundWorkService;
			const source = yield* seedStream("sibling-edit");
			const initial = yield* currentJob(source.id);
			const adjustment = yield* seedAdjustment({
				id: "sibling-adjustment",
				entityId: source.entityId,
			});
			yield* controls.setProcessor(source.id, () =>
				Effect.succeed({ ...page(source.eventId, 1, "old"), done: true }),
			);
			yield* process(initial);
			const queued = yield* streams.get(source.id);
			assert(queued?.currentJobId);
			yield* background.dispatch(queued.currentJobId);
			yield* processCurrent(source.id);
			const beforeSource = yield* sourceState(source.eventId);
			yield* events.edit(
				{ eventId: adjustment.id, patch: { properties: { remove: [], set: { value: 2 } } } },
				userId,
				command("sibling-edit"),
			);
			const dirty = yield* streams.get(source.id);
			expect(dirty?.checkpoint).toBeNull();
			expect(dirty?.dirtyFrom).toBeNull();
			yield* service.reconcile();
			yield* controls.setProcessor(source.id, () =>
				Effect.gen(function* () {
					yield* events
						.delete({ userId, eventId: adjustment.id }, command("sibling-delete"))
						.pipe(Effect.orDie);
					return { ...page(source.eventId, 99, "stale"), done: true };
				}),
			);
			const stale = yield* processCurrent(source.id);
			expect(yield* sourceState(source.eventId)).toEqual(beforeSource);
			expect(yield* projection(source.eventId)).toEqual({ properties: { score: 1 } });
			const next = yield* streams.get(source.id);
			expect(next?.currentJobId).not.toBe(stale.id);
			expect(next?.checkpoint).toBeNull();
			expect(next?.completedRevision).not.toBe(next?.streamRevision);
		}),
	);

	test.effect(
		"admits every output stream in a no-hook source batch and serializes their scope",
		() =>
			Effect.gen(function* () {
				const source = yield* seedStream("source-batch-admission");
				const session = yield* DatabaseSession;
				const events = yield* EventsRepository;
				const streams = yield* EventStreamRepository;
				const service = yield* EventStreamWorkService;
				const mutations = yield* EventMutations;
				const execution = yield* LifecycleExecution;
				const background = yield* BackgroundWorkService;
				const controls = yield* StreamWorkControls;
				const summaryEventId = EventId.make("source-batch-summary");
				yield* session.transaction(
					events.createEvent({
						userId,
						occurredAt,
						properties: {},
						id: summaryEventId,
						entityId: source.entityId,
						eventSchemaName: "Summary",
						eventSchemaSlug: summarySchemaSlug,
						eventSchemaPluginId: source.fixture.pluginId,
					}),
				);
				const summaryId = yield* service.request({
					pluginPin: source.fixture.pluginPin,
					accountGeneration: source.fixture.accountGeneration,
					processorScriptId: source.fixture.processorScriptId,
					request: { entityId: source.entityId, eventSchemaSlug: summarySchemaSlug },
					command: {
						...command("source-batch-summary-request"),
						writeContext: source.fixture.principal,
					},
				});
				for (const id of [source.id, summaryId]) {
					yield* controls.setProcessor(id, () =>
						Effect.succeed({ done: true, updates: [], checkpoint: null }),
					);
					const work = yield* streams.get(id);
					assert(work?.currentJobId);
					yield* background.dispatch(work.currentJobId);
					yield* processCurrent(id);
				}
				const writeCommand = command("source-batch-coordination");
				const prepared = yield* session.transaction(
					mutations.prepare({
						userId,
						command: writeCommand,
						changes: [
							{
								kind: "create",
								itemIdentity: "coordination",
								item: {
									properties: { value: 1 },
									entityId: source.entityId,
									eventSchemaSlug: coordinationSchemaSlug,
								},
							},
						],
					}),
				);
				const validated = {
					triggerId: null,
					references: prepared.references,
					items: (yield* eventPolicyItems(prepared)).map((item) =>
						Object.assign({}, item, { patches: [], error: null, processed: [], rejected: null }),
					),
				};
				const callsBefore = (yield* controls.workflowCalls).length;
				const committed = yield* mutations.transaction(
					mutations.persist({ userId, prepared, validated, command: writeCommand }),
				);
				expect((yield* controls.workflowCalls).length).toBe(callsBefore);
				const ids = committed.dispatch.flatMap((plan) => plan.backgroundJobIds);
				expect(ids).toHaveLength(2);
				expect(committed.dispatch.flatMap((plan) => plan.runs)).toEqual([]);
				const queued = yield* session.run((db) =>
					db
						.select({
							id: tables.backgroundWork.id,
							scope: tables.backgroundWork.scope,
							status: tables.backgroundWork.status,
						})
						.from(tables.backgroundWork)
						.where(inArray(tables.backgroundWork.id, ids)),
				);
				expect(queued).toHaveLength(2);
				expect(
					queued.every((job) => job.scope === source.entityId && job.status === "queued"),
				).toBe(true);
				const replayed = yield* mutations.transaction(
					mutations.persist({ userId, prepared, validated, command: writeCommand }),
				);
				expect(replayed).toEqual(committed);
				yield* execution.dispatch(committed.dispatch);
				const dispatched = yield* session.run((db) =>
					db
						.select({ status: tables.backgroundWork.status })
						.from(tables.backgroundWork)
						.where(inArray(tables.backgroundWork.id, ids)),
				);
				expect(dispatched.map((job) => job.status).sort()).toEqual(["queued", "running"]);
				for (const id of [source.id, summaryId]) {
					yield* controls.setProcessor(id, () =>
						Effect.succeed({
							done: true,
							checkpoint: null,
							updates: [
								{
									properties: { score: 6 },
									eventId: id === source.id ? source.eventId : summaryEventId,
								},
							],
						}),
					);
				}
				const first = yield* session.run((db) =>
					db
						.select({ id: tables.eventStreamWork.id })
						.from(tables.eventStreamWork)
						.innerJoin(
							tables.backgroundWork,
							eq(tables.backgroundWork.id, tables.eventStreamWork.currentJobId),
						)
						.where(
							and(
								inArray(tables.backgroundWork.id, ids),
								eq(tables.backgroundWork.status, "running"),
							),
						),
				);
				assert(first[0]);
				yield* processCurrent(first[0].id);
				yield* execution.dispatch(committed.dispatch);
				const secondId = first[0].id === source.id ? summaryId : source.id;
				yield* processCurrent(secondId);
				expect(yield* projection(source.eventId)).toEqual({ properties: { score: 6 } });
				expect(yield* projection(summaryEventId)).toEqual({ properties: { score: 6 } });
			}),
	);

	test.effect("invalidates old and new property scopes during opposite reference moves", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const service = yield* EventStreamWorkService;
			const background = yield* BackgroundWorkService;
			const events = yield* EventsService;
			const left = yield* seedStream("move-left");
			const right = yield* seedStream("move-right");
			const holder = yield* seedStream("move-holder");
			const initialLeft = yield* currentJob(left.id);
			const initialRight = yield* currentJob(right.id);
			const first = yield* seedAdjustment({
				id: "move-first",
				subject: left.entityId,
				entityId: holder.entityId,
			});
			const second = yield* seedAdjustment({
				id: "move-second",
				subject: right.entityId,
				entityId: holder.entityId,
			});
			for (const [source, initial] of [
				[left, initialLeft],
				[right, initialRight],
			] as const) {
				yield* controls.setProcessor(source.id, () =>
					Effect.succeed({ ...page(source.eventId, 1, "old"), done: true }),
				);
				yield* process(initial);
				const current = yield* streams.get(source.id);
				assert(current?.currentJobId);
				yield* background.dispatch(current.currentJobId);
			}
			const beforeLeft = yield* streams.get(left.id);
			const beforeRight = yield* streams.get(right.id);
			assert(beforeLeft?.currentJobId);
			assert(beforeRight?.currentJobId);
			const leftJob = yield* background.start(beforeLeft.currentJobId);
			const rightJob = yield* background.start(beforeRight.currentJobId);
			assert(leftJob);
			assert(rightJob);
			yield* Effect.all(
				[
					events.edit(
						{
							eventId: first.id,
							patch: { properties: { remove: [], set: { subject: right.entityId } } },
						},
						userId,
						command("move-first"),
					),
					events.edit(
						{
							eventId: second.id,
							patch: { properties: { remove: [], set: { subject: left.entityId } } },
						},
						userId,
						command("move-second"),
					),
				],
				{ concurrency: 2 },
			);
			yield* process(leftJob);
			yield* process(rightJob);
			expect(yield* projection(left.eventId)).toBeNull();
			expect(yield* projection(right.eventId)).toBeNull();
			expect((yield* streams.get(left.id))?.streamRevision).toBe(beforeLeft.streamRevision + 2);
			expect((yield* streams.get(right.id))?.streamRevision).toBe(beforeRight.streamRevision + 2);
			yield* service.reconcile();
		}),
	);

	test.effect(
		"preserves source ordinals, reference scopes, restart flags, and exact target ownership",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const source = yield* seedRetainedTargets("dependency-targets", 1);
				const [subject] = source.children;
				assert(subject);
				const wrongSchema = EntityId.make("dependency-wrong-schema-target");
				const wrongPlugin = EntityId.make("dependency-wrong-plugin-target");
				const wrongOwner = EntityId.make("dependency-wrong-owner-target");
				yield* session.run((db) =>
					db.insert(tables.entity).values([
						{
							id: wrongSchema,
							name: wrongSchema,
							entitySchemaSlug: "other",
							entitySchemaPluginId: source.fixture.pluginId,
						},
						{ id: wrongPlugin, entitySchemaSlug, name: wrongPlugin },
						{
							id: wrongOwner,
							name: wrongOwner,
							entitySchemaSlug,
							userId: "recipient",
							entitySchemaPluginId: source.fixture.pluginId,
						},
					]),
				);
				const adjustment = {
					...source.key,
					properties: { subject },
					eventSchemaSlug: adjustmentSchemaSlug,
				};
				const rows = yield* session.run((db) =>
					db.execute<StreamKey & { sourceIndex: number; restart: null | boolean }>(
						sql`
					select * from (${projectionDependencyTargets(
						projectionSources([
							source.key,
							adjustment,
							adjustment,
							{ ...adjustment, entityId: wrongSchema, properties: { subject: null } },
							{ ...adjustment, eventSchemaPluginId: null },
							{ ...adjustment, properties: {}, userId: UserId.make("recipient") },
							{ ...adjustment, entityId: wrongSchema, properties: { subject: wrongPlugin } },
							{ ...adjustment, entityId: wrongSchema, properties: { subject: wrongOwner } },
						]),
					)}) targets order by "sourceIndex", "entityId", restart
				`,
						"objects",
					),
				);
				expect(rows).toEqual(
					[
						{ userId, sourceIndex: 0, restart: false, entityId: source.holder },
						...[1, 2].flatMap((sourceIndex) =>
							[subject, source.holder].map((entityId) => ({
								userId,
								entityId,
								sourceIndex,
								restart: true,
							})),
						),
					].map((target) =>
						Object.assign(target, {
							eventSchemaSlug,
							eventSchemaPluginId: source.fixture.pluginId,
						}),
					),
				);
				const service = yield* EventStreamWorkService;
				const streams = yield* EventStreamRepository;
				const controls = yield* StreamWorkControls;
				yield* service.request({
					pluginPin: source.fixture.pluginPin,
					accountGeneration: source.fixture.accountGeneration,
					processorScriptId: source.fixture.processorScriptId,
					request: { eventSchemaSlug, entityId: source.holder },
					command: { ...command("same-stream-restart"), writeContext: source.fixture.principal },
				});
				yield* controls.setProcessor(source.id, () =>
					Effect.succeed({ ...page(source.eventId, 1, "complete"), done: true }),
				);
				yield* processCurrent(source.id);
				const before = yield* streams.get(source.id);
				assert(before);
				yield* session.transaction(
					streams.touch([{ ...adjustment, occurredAt, properties: { subject: source.holder } }]),
				);
				const after = yield* streams.get(source.id);
				expect(after?.streamRevision).toBe(before.streamRevision + 1);
				expect(after?.checkpoint).toBeNull();
				expect(after?.dirtyFrom).toBeNull();
				expect(after?.currentJobId).toBeNull();
			}),
	);
});
