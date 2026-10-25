import { assert, expect, layer } from "@effect/vitest";
import { EntityId, EventId, UserId } from "@ryot-app/contract/schema/brands";
import { inArray, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import type { BackgroundWorkInput } from "#modules/background-work/model";
import { EventMutations, eventPolicyItems } from "#modules/events/mutations";
import {
	projectionDependencyTargets,
	projectionSources,
} from "#modules/events/projection-dependencies";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { EventStreamRepository, type StreamKey } from "#modules/events/stream-repository";
import { streamState } from "#modules/events/stream-repository.test-support";
import { EventStreamWorkService } from "#modules/events/stream-work";
import {
	activeJob,
	adjustmentSchemaSlug,
	backgroundJob,
	command,
	coordinationSchemaSlug,
	entitySchemaSlug,
	eventSchemaSlug,
	occurredAt,
	page,
	prepare,
	processNext,
	projection,
	publish,
	runBackgroundJob,
	seedAdjustment,
	seedRetainedTargets,
	seedStream,
	sourceState,
	startJob,
	StreamWorkControls,
	streamWorkTestLayer,
	summarySchemaSlug,
	userId,
} from "#modules/events/stream-work.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

const ClaimedRevisions = Schema.Struct({
	streams: Schema.Array(Schema.Struct({ id: Schema.String, revision: Schema.Int })),
});

layer(streamWorkTestLayer)((test) => {
	test.effect("keeps one queued job per user and schema and runs the dirty state it finds", () =>
		Effect.gen(function* () {
			const events = yield* EventsService;
			const controls = yield* StreamWorkControls;
			const source = yield* seedStream("queued-reuse");
			const initial = yield* streamState(source.id);
			assert(initial);
			const [running] = yield* activeJob();
			assert(running?.status === "running");
			const queued: Array<ReadonlyArray<string>> = [];
			for (const rating of [2, 3, 4]) {
				yield* events.edit(
					{ eventId: source.eventId, patch: { properties: { remove: [], set: { rating } } } },
					userId,
					command(`queued-reuse-${rating}`),
				);
				queued.push(
					(yield* activeJob()).filter(({ status }) => status === "queued").map(({ id }) => id),
				);
			}
			const [first] = queued;
			assert(first?.length === 1);
			expect(queued).toEqual([first, first, first]);
			yield* controls.setProcessor(source.id, () =>
				Effect.succeed({ ...page(source.eventId, 4, "current"), done: true }),
			);
			const executed: Array<{ id: string; revisions: ReadonlyArray<number> }> = [];
			const execute = (job: BackgroundWorkInput) =>
				Effect.gen(function* () {
					const claim = yield* Schema.decodeUnknownEffect(ClaimedRevisions)(job.featureInput);
					executed.push({
						id: job.id,
						revisions: claim.streams
							.filter(({ id }) => id === source.id)
							.map(({ revision }) => revision),
					});
					return yield* controls.runProcessor(job);
				}).pipe(Effect.orDie);
			yield* runBackgroundJob(running.id, execute);
			expect(executed).toEqual([{ id: running.id, revisions: [initial.streamRevision + 3] }]);
			expect(yield* projection(source.eventId)).toEqual({ properties: { score: 4 } });
			const [queuedId] = first;
			assert(queuedId);
			yield* runBackgroundJob(queuedId, execute);
			expect(executed).toHaveLength(1);
			expect(yield* backgroundJob(queuedId)).toEqual({ error: null, status: "succeeded" });
			expect(yield* activeJob()).toEqual([]);
		}),
	);

	test.effect(
		"keeps the publication fence when a source changes after projection preparation",
		() =>
			Effect.gen(function* () {
				const events = yield* EventsService;
				const controls = yield* StreamWorkControls;
				const source = yield* seedStream("prepared-then-stale");
				const job = yield* startJob();
				yield* controls.setProcessor(source.id, () =>
					Effect.succeed({ ...page(source.eventId, 9, "stale"), done: true }),
				);
				yield* runBackgroundJob(job.id, (input) =>
					Effect.gen(function* () {
						yield* events.edit(
							{
								eventId: source.eventId,
								patch: { properties: { remove: [], set: { rating: 2 } } },
							},
							userId,
							command("prepared-then-stale-edit"),
						);
						return yield* controls.runProcessor(input);
					}).pipe(Effect.orDie),
				);
				expect(yield* projection(source.eventId)).toBeNull();
				expect(yield* backgroundJob(job.id)).toEqual({ error: null, status: "succeeded" });
				expect(yield* streamState(source.id)).toMatchObject({
					currentJobId: null,
					completedRevision: null,
				});
				expect((yield* activeJob()).map(({ status }) => status)).toEqual(["running"]);
				yield* processNext();
				expect(yield* projection(source.eventId)).toEqual({ properties: { score: 9 } });
			}),
	);

	test.effect("does not commit a stale result after its source event is edited or deleted", () =>
		Effect.gen(function* () {
			const eventService = yield* EventsService;
			const events = yield* EventsRepository;
			const controls = yield* StreamWorkControls;
			const edited = yield* seedStream("concurrent-edit");
			const deleted = yield* seedStream("deleted-source");
			const before = yield* streamState(edited.id);
			assert(before);
			yield* controls.setProcessor(edited.id, () =>
				eventService
					.edit(
						{ eventId: edited.eventId, patch: { properties: { remove: [], set: { rating: 2 } } } },
						userId,
						command("ordinary-source-edit"),
					)
					.pipe(Effect.orDie, Effect.as(page(edited.eventId, 9, "stale-result"))),
			);
			yield* controls.setProcessor(deleted.id, () =>
				eventService
					.delete({ userId, eventId: deleted.eventId }, command("delete-stream-source"))
					.pipe(
						Effect.orDie,
						Effect.as({ done: false, updates: [], checkpoint: { cursor: "deleted" } }),
					),
			);

			const job = yield* processNext();

			const source = yield* events.getEventSnapshot({ userId, eventId: edited.eventId });
			expect(source?.snapshot.properties).toEqual({ rating: 2 });
			expect(yield* events.getEventSnapshot({ userId, eventId: deleted.eventId })).toBeNull();
			for (const id of [edited.id, deleted.id]) {
				expect(yield* streamState(id)).toMatchObject({ checkpoint: null, currentJobId: null });
			}
			expect((yield* streamState(edited.id))?.streamRevision).toBeGreaterThan(
				before.streamRevision,
			);
			const [next] = yield* activeJob();
			expect(next).toMatchObject({ status: "queued" });
			expect(next?.id).not.toBe(job.id);
			yield* controls.setProcessor(edited.id, () =>
				Effect.succeed({ ...page(edited.eventId, 2, "fresh"), done: true }),
			);
			yield* processNext();
		}),
	);

	test.effect("fences sibling edits and deletions without changing the output source", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const events = yield* EventsService;
			const source = yield* seedStream("sibling-edit");
			const adjustment = yield* seedAdjustment({
				id: "sibling-adjustment",
				entityId: source.entityId,
			});
			yield* controls.setProcessor(source.id, () =>
				Effect.succeed({ ...page(source.eventId, 1, "old"), done: true }),
			);
			yield* processNext();
			expect(yield* projection(source.eventId)).toEqual({ properties: { score: 1 } });
			const beforeSource = yield* sourceState(source.eventId);
			yield* events.edit(
				{ eventId: adjustment.id, patch: { properties: { remove: [], set: { value: 2 } } } },
				userId,
				command("sibling-edit"),
			);
			expect(yield* streamState(source.id)).toMatchObject({ dirtyFrom: null, checkpoint: null });
			yield* controls.setProcessor(source.id, () =>
				events
					.delete({ userId, eventId: adjustment.id }, command("sibling-delete"))
					.pipe(Effect.orDie, Effect.as({ ...page(source.eventId, 99, "stale"), done: true })),
			);
			const stale = yield* processNext();
			expect(yield* sourceState(source.eventId)).toEqual(beforeSource);
			expect(yield* projection(source.eventId)).toEqual({ properties: { score: 1 } });
			const next = yield* streamState(source.id);
			expect(next).toMatchObject({ checkpoint: null, currentJobId: null });
			expect(next?.completedRevision).not.toBe(next?.streamRevision);
			yield* controls.setProcessor(source.id, () =>
				Effect.succeed({ ...page(source.eventId, 2, "fresh"), done: true }),
			);
			expect((yield* processNext()).id).not.toBe(stale.id);
		}),
	);

	test.effect("admits one job per output schema for a no-hook source batch", () =>
		Effect.gen(function* () {
			const source = yield* seedStream("source-batch-admission");
			const session = yield* DatabaseSession;
			const events = yield* EventsRepository;
			const service = yield* EventStreamWorkService;
			const mutations = yield* EventMutations;
			const execution = yield* LifecycleExecution;
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
			yield* processNext();
			yield* processNext(summarySchemaSlug);
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
			expect(committed.dispatch.flatMap((plan) => plan.runs)).toEqual([]);
			const jobs = () =>
				session.run((db) =>
					db
						.select({ scope: tables.backgroundWork.scope, status: tables.backgroundWork.status })
						.from(tables.backgroundWork)
						.where(inArray(tables.backgroundWork.id, ids))
						.orderBy(tables.backgroundWork.scope),
				);
			expect(yield* jobs()).toEqual([
				{ status: "queued", scope: eventSchemaSlug },
				{ status: "queued", scope: summarySchemaSlug },
			]);
			const replayed = yield* mutations.transaction(
				mutations.persist({ userId, prepared, validated, command: writeCommand }),
			);
			expect(replayed).toEqual(committed);
			yield* execution.dispatch(committed.dispatch);
			expect((yield* jobs()).map(({ status }) => status)).toEqual(["running", "running"]);
			for (const [id, eventId] of [
				[source.id, source.eventId],
				[summaryId, summaryEventId],
			] as const) {
				yield* controls.setProcessor(id, () =>
					Effect.succeed({
						done: true,
						checkpoint: null,
						updates: [{ eventId, properties: { score: 6 } }],
					}),
				);
			}
			yield* processNext();
			yield* processNext(summarySchemaSlug);
			expect(yield* projection(source.eventId)).toEqual({ properties: { score: 6 } });
			expect(yield* projection(summaryEventId)).toEqual({ properties: { score: 6 } });
		}),
	);

	test.effect("invalidates old and new property scopes during opposite reference moves", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const events = yield* EventsService;
			const left = yield* seedStream("move-left");
			const right = yield* seedStream("move-right");
			const holder = yield* seedStream("move-holder");
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
			const job = yield* prepare(yield* startJob());
			const beforeLeft = yield* streamState(left.id);
			const beforeRight = yield* streamState(right.id);
			assert(beforeLeft && beforeRight);
			for (const source of [left, right]) {
				yield* controls.setProcessor(source.id, () =>
					Effect.succeed({ ...page(source.eventId, 1, "old"), done: true }),
				);
			}
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
			yield* publish(job);
			expect(yield* projection(left.eventId)).toBeNull();
			expect(yield* projection(right.eventId)).toBeNull();
			expect((yield* streamState(left.id))?.streamRevision).toBe(beforeLeft.streamRevision + 2);
			expect((yield* streamState(right.id))?.streamRevision).toBe(beforeRight.streamRevision + 2);
			yield* processNext();
			expect(yield* projection(left.eventId)).toEqual({ properties: { score: 1 } });
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
				yield* processNext();
				const before = yield* streamState(source.id);
				assert(before);
				yield* session.transaction(
					streams.touch([{ ...adjustment, occurredAt, properties: { subject: source.holder } }]),
				);
				expect(yield* streamState(source.id)).toMatchObject({
					dirtyFrom: null,
					checkpoint: null,
					currentJobId: null,
					completedRevision: null,
					streamRevision: before.streamRevision + 1,
				});
			}),
	);
});
