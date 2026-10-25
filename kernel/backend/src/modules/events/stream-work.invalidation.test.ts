import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { EntityId, EventId, UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Deferred, Effect, Fiber, Schema } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import type { BackgroundWorkInput } from "#modules/background-work/model";
import { BackgroundWorkService } from "#modules/background-work/service";
import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { EventMutations, eventPolicyItems } from "#modules/events/mutations";
import {
	projectionDependencyTargets,
	projectionSources,
} from "#modules/events/projection-dependencies";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import {
	eventStreamId,
	EventStreamRepository,
	type StreamKey,
} from "#modules/events/stream-repository";
import { EventStreamWorkService } from "#modules/events/stream-work";
import {
	adjustmentSchemaSlug,
	backgroundJob,
	command,
	coordinationSchemaSlug,
	currentJob,
	dependencyInput,
	dependencySchemaSlug,
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
	seedRetainedDependencyTargets,
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

	test.effect("admits old and new mapped targets from ordinary input moves and deletes", () =>
		Effect.gen(function* () {
			const parent = yield* seedStream("admission-mapping-parent");
			const left = yield* seedStream("admission-mapping-left");
			const right = yield* seedStream("admission-mapping-right");
			const streams = yield* EventStreamRepository;
			const events = yield* EventsRepository;
			const eventService = yield* EventsService;
			const session = yield* DatabaseSession;
			const background = yield* BackgroundWorkService;
			const controls = yield* StreamWorkControls;
			const initial = yield* currentJob(left.id);
			const mapping = yield* session.transaction(
				events.createEvent(
					dependencyInput(left.fixture, {
						child: left.entityId,
						id: "admission-mapping",
						parent: parent.entityId,
						entityId: parent.entityId,
					}),
				),
			);
			const input = yield* seedAdjustment({
				entityId: parent.entityId,
				id: "admission-mapping-input",
			});
			for (const target of [left, right]) {
				yield* controls.setProcessor(target.id, () =>
					Effect.succeed({ done: true, updates: [], checkpoint: null }),
				);
			}
			yield* process(initial);
			const leftWork = yield* streams.get(left.id);
			assert(leftWork?.currentJobId);
			yield* background.dispatch(leftWork.currentJobId);
			const leftCompleted = yield* processCurrent(left.id);
			const rightCompleted = yield* processCurrent(right.id);
			yield* eventService.edit(
				{ eventId: input.id, patch: { properties: { remove: [], set: { value: 2 } } } },
				userId,
				command("admission-parent-edit"),
			);
			const leftAdmitted = yield* streams.get(left.id);
			assert(leftAdmitted?.currentJobId);
			expect(leftAdmitted.currentJobId).not.toBe(leftCompleted.id);
			expect((yield* streams.get(right.id))?.currentJobId).toBe(rightCompleted.id);
			const stale = yield* currentJob(left.id);
			yield* eventService.edit(
				{
					eventId: mapping.id,
					patch: { properties: { remove: [], set: { child: right.entityId } } },
				},
				userId,
				command("admission-mapping-move"),
			);
			const movedLeft = yield* streams.get(left.id);
			const movedRight = yield* streams.get(right.id);
			assert(movedLeft?.currentJobId);
			assert(movedRight?.currentJobId);
			expect(movedLeft.currentJobId).not.toBe(stale.id);
			expect(movedRight.currentJobId).not.toBe(rightCompleted.id);
			yield* controls.setProcessor(left.id, () =>
				Effect.succeed({ ...page(left.eventId, 99, "old-mapping"), done: true }),
			);
			yield* process(stale);
			expect(yield* projection(left.eventId)).toBeNull();
			yield* eventService.delete(
				{ userId, eventId: mapping.id },
				command("admission-mapping-delete"),
			);
			expect((yield* streams.get(right.id))?.currentJobId).not.toBe(movedRight.currentJobId);
			expect((yield* streams.get(right.id))?.currentJobId).not.toBeNull();
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
				const committed = yield* session.transaction(
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
				const replayed = yield* session.transaction(
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

	test.effect(
		"invalidates old and new property and session scopes during opposite reference moves",
		() =>
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
					sessionEntityId: left.entityId,
				});
				const second = yield* seedAdjustment({
					id: "move-second",
					subject: right.entityId,
					entityId: holder.entityId,
					sessionEntityId: right.entityId,
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
								patch: {
									sessionEntityId: right.entityId,
									properties: { remove: [], set: { subject: right.entityId } },
								},
							},
							userId,
							command("move-first"),
						),
						events.edit(
							{
								eventId: second.id,
								patch: {
									sessionEntityId: left.entityId,
									properties: { remove: [], set: { subject: left.entityId } },
								},
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

	test.effect("serializes mapping phantoms with source writes in both commit orders", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const events = yield* EventsRepository;
			const streams = yield* EventStreamRepository;
			const controls = yield* StreamWorkControls;
			for (const first of ["mapping", "source"]) {
				const parent = yield* seedStream(`phantom-${first}-parent`);
				const child = yield* seedStream(`phantom-${first}-child`);
				const holder = yield* seedStream(`phantom-${first}-holder`);
				const oldJob = yield* currentJob(child.id);
				const before = yield* streams.get(child.id);
				assert(before);
				const mapping = dependencyInput(child.fixture, {
					child: child.entityId,
					parent: parent.entityId,
					entityId: holder.entityId,
					id: `phantom-${first}-mapping`,
				});
				const source = {
					...mapping,
					properties: { value: 2 },
					entityId: parent.entityId,
					eventSchemaName: "Adjustment",
					eventSchemaSlug: adjustmentSchemaSlug,
					id: EventId.make(`phantom-${first}-input`),
				};
				const held = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const attempted = yield* Deferred.make<void>();
				const leader = yield* session
					.transaction(
						Effect.gen(function* () {
							yield* events.createEvent(first === "mapping" ? mapping : source);
							yield* Deferred.succeed(held, undefined);
							yield* Deferred.await(release);
						}),
					)
					.pipe(Effect.forkChild);
				yield* Deferred.await(held);
				assertExitFails(
					yield* Effect.exit(
						session
							.transaction(
								session.run((db) =>
									db.execute(sql`
					select id from entity where id = ${parent.entityId} for no key update nowait
				`),
								),
							)
							.pipe(Effect.mapError(() => new DbError({ message: "Source reference is locked" }))),
					),
					new DbError({ message: "Source reference is locked" }),
				);
				const follower = yield* session
					.transaction(
						Effect.gen(function* () {
							yield* Deferred.succeed(attempted, undefined);
							yield* events.createEvent(first === "mapping" ? source : mapping);
						}),
					)
					.pipe(Effect.forkChild);
				yield* Deferred.await(attempted);
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(leader);
				yield* Fiber.join(follower);
				const changed = yield* streams.get(child.id);
				expect(changed?.streamRevision).toBe(before.streamRevision + (first === "mapping" ? 2 : 1));
				yield* controls.setProcessor(child.id, () =>
					Effect.succeed({ ...page(child.eventId, 99, "stale-parent"), done: true }),
				);
				yield* process(oldJob);
				expect(yield* projection(child.eventId)).toBeNull();
				expect((yield* streams.get(child.id))?.completedRevision).toBeNull();
			}
		}),
	);

	test.effect("fences both targets of concurrent mapping moves and deletion", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const events = yield* EventsRepository;
			const streams = yield* EventStreamRepository;
			const firstParent = yield* seedStream("mapping-move-parent-a");
			const secondParent = yield* seedStream("mapping-move-parent-b");
			const firstChild = yield* seedStream("mapping-move-child-a");
			const secondChild = yield* seedStream("mapping-move-child-b");
			const firstMapping = dependencyInput(firstChild.fixture, {
				id: "mapping-move-a",
				child: firstChild.entityId,
				parent: firstParent.entityId,
				entityId: firstParent.entityId,
			});
			const secondMapping = dependencyInput(firstChild.fixture, {
				id: "mapping-move-b",
				child: secondChild.entityId,
				parent: secondParent.entityId,
				entityId: secondParent.entityId,
			});
			yield* session.transaction(events.createEvent(firstMapping));
			yield* session.transaction(events.createEvent(secondMapping));
			const beforeFirst = yield* streams.get(firstChild.id);
			const beforeSecond = yield* streams.get(secondChild.id);
			assert(beforeFirst);
			assert(beforeSecond);
			const a = yield* events.getEventSnapshot({ userId, eventId: firstMapping.id });
			const b = yield* events.getEventSnapshot({ userId, eventId: secondMapping.id });
			assert(a);
			assert(b);
			yield* Effect.all(
				[
					session.transaction(
						events.updatePreparedEvent({
							userId,
							updatedAt: occurredAt,
							eventId: firstMapping.id,
							expectedRevision: a.revision,
							draft: {
								...a.snapshot,
								properties: { child: secondChild.entityId, parent: secondParent.entityId },
							},
						}),
					),
					session.transaction(
						events.updatePreparedEvent({
							userId,
							updatedAt: occurredAt,
							eventId: secondMapping.id,
							expectedRevision: b.revision,
							draft: {
								...b.snapshot,
								properties: { child: firstChild.entityId, parent: firstParent.entityId },
							},
						}),
					),
				],
				{ concurrency: 2 },
			);
			expect((yield* streams.get(firstChild.id))?.streamRevision).toBe(
				beforeFirst.streamRevision + 2,
			);
			expect((yield* streams.get(secondChild.id))?.streamRevision).toBe(
				beforeSecond.streamRevision + 2,
			);
			yield* session.transaction(events.deleteEvent({ userId, eventId: secondMapping.id }));
			expect((yield* streams.get(firstChild.id))?.streamRevision).toBe(
				beforeFirst.streamRevision + 3,
			);
			yield* seedAdjustment({ entityId: firstParent.entityId, id: "mapping-move-parent-write" });
			expect((yield* streams.get(firstChild.id))?.streamRevision).toBe(
				beforeFirst.streamRevision + 3,
			);
			yield* seedAdjustment({
				entityId: secondParent.entityId,
				id: "mapping-move-other-parent-write",
			});
			expect((yield* streams.get(secondChild.id))?.streamRevision).toBe(
				beforeSecond.streamRevision + 3,
			);
		}),
	);

	test.effect("maps session and property inputs without crossing user or plugin ownership", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const events = yield* EventsRepository;
			const streams = yield* EventStreamRepository;
			const parent = yield* seedStream("mapping-owner-parent");
			const child = yield* seedStream("mapping-owner-child");
			const excluded = yield* seedStream("mapping-owner-excluded");
			const holder = yield* seedStream("mapping-owner-holder");
			yield* session.transaction(
				events.createEvent(
					dependencyInput(child.fixture, {
						child: child.entityId,
						parent: parent.entityId,
						id: "mapping-owner-valid",
						entityId: holder.entityId,
					}),
				),
			);
			yield* session.run((db) =>
				db.insert(tables.event).values([
					{
						...dependencyInput(child.fixture, {
							parent: parent.entityId,
							child: excluded.entityId,
							entityId: holder.entityId,
							id: "mapping-owner-foreign-user",
						}),
						userId: "recipient",
					},
					{
						...dependencyInput(child.fixture, {
							parent: parent.entityId,
							child: excluded.entityId,
							entityId: holder.entityId,
							id: "mapping-owner-foreign-plugin",
						}),
						eventSchemaPluginId: null,
					},
				]),
			);
			const before = yield* streams.get(child.id);
			const excludedBefore = yield* streams.get(excluded.id);
			assert(before);
			assert(excludedBefore);
			yield* seedAdjustment({
				entityId: holder.entityId,
				sessionEntityId: parent.entityId,
				id: "mapping-owner-session-input",
			});
			yield* seedAdjustment({
				subject: parent.entityId,
				entityId: holder.entityId,
				id: "mapping-owner-property-input",
			});
			expect((yield* streams.get(child.id))?.streamRevision).toBe(before.streamRevision + 2);
			expect((yield* streams.get(excluded.id))?.streamRevision).toBe(excludedBefore.streamRevision);
		}),
	);

	test.effect(
		"preserves source ordinals, reference scopes, restart flags, and exact target ownership",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const source = yield* seedRetainedDependencyTargets("dependency-targets", 2);
				const [first, second] = source.children;
				assert(first);
				assert(second);
				const shared = EntityId.make("dependency-shared-target");
				const foreignUser = EntityId.make("dependency-foreign-user-target");
				const foreignPlugin = EntityId.make("dependency-foreign-plugin-target");
				const wrongSchema = EntityId.make("dependency-wrong-schema-target");
				const wrongPlugin = EntityId.make("dependency-wrong-plugin-target");
				const wrongOwner = EntityId.make("dependency-wrong-owner-target");
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values([
							...[shared, foreignUser, foreignPlugin].map((id) => ({
								id,
								name: id,
								entitySchemaSlug,
								entitySchemaPluginId: source.fixture.pluginId,
							})),
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
				yield* session.run((db) =>
					db
						.insert(tables.event)
						.values([
							...[shared, wrongSchema, wrongPlugin, wrongOwner].map((child) =>
								dependencyInput(source.fixture, {
									child,
									parent: source.holder,
									entityId: source.holder,
									id: `dependency-targets-${child}`,
								}),
							),
							{
								...dependencyInput(source.fixture, {
									child: foreignUser,
									parent: source.holder,
									entityId: source.holder,
									id: "dependency-targets-foreign-user",
								}),
								userId: "recipient",
							},
							{
								...dependencyInput(source.fixture, {
									child: foreignPlugin,
									parent: source.holder,
									entityId: source.holder,
									id: "dependency-targets-foreign-plugin",
								}),
								eventSchemaPluginId: null,
							},
						]),
				);
				const adjustment = {
					...source.key,
					sessionEntityId: first,
					properties: { subject: second },
					eventSchemaSlug: adjustmentSchemaSlug,
				};
				const rows = yield* session.run((db) =>
					db.execute<StreamKey & { sourceIndex: number; restart: null | boolean }>(
						sql`
					select * from (${projectionDependencyTargets(
						projectionSources([
							{ ...source.key, sessionEntityId: source.holder },
							adjustment,
							adjustment,
							{
								...source.key,
								properties: { child: second },
								eventSchemaSlug: dependencySchemaSlug,
							},
							{
								...adjustment,
								entityId: wrongSchema,
								sessionEntityId: null,
								properties: { subject: null },
							},
							{ ...adjustment, properties: {}, entityId: wrongSchema, sessionEntityId: null },
							{ ...adjustment, eventSchemaPluginId: null },
							{
								...adjustment,
								properties: {},
								sessionEntityId: null,
								userId: UserId.make("recipient"),
							},
							{
								...adjustment,
								entityId: wrongSchema,
								sessionEntityId: shared,
								properties: { subject: shared },
							},
							{
								...source.key,
								properties: { child: wrongOwner },
								eventSchemaSlug: dependencySchemaSlug,
							},
							{
								...source.key,
								eventSchemaSlug: dependencySchemaSlug,
								properties: { parent: null, child: shared },
							},
						]),
					)}) targets order by "sourceIndex", "entityId", restart
				`,
						"objects",
					),
				);
				expect(rows).toEqual(
					[
						{ userId, sourceIndex: 0, restart: false, entityId: source.holder },
						{ userId, restart: true, sourceIndex: 0, entityId: source.holder },
						...[1, 2].flatMap((sourceIndex) =>
							[first, second, source.holder, shared].map((entityId) => ({
								userId,
								entityId,
								sourceIndex,
								restart: true,
							})),
						),
						{ userId, restart: true, sourceIndex: 3, entityId: second },
						{
							restart: true,
							sourceIndex: 7,
							entityId: foreignUser,
							userId: UserId.make("recipient"),
						},
						{ userId, restart: true, sourceIndex: 8, entityId: shared },
						{ userId, restart: true, sourceIndex: 10, entityId: shared },
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
					streams.touch([{ ...source.key, occurredAt, sessionEntityId: source.holder }]),
				);
				const after = yield* streams.get(source.id);
				expect(after?.streamRevision).toBe(before.streamRevision + 1);
				expect(after?.checkpoint).toBeNull();
				expect(after?.dirtyFrom).toBeNull();
				expect(after?.currentJobId).toBeNull();
			}),
	);

	test.effect("does not treat JSON null through mappings as absent mappings", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const source = yield* seedRetainedDependencyTargets("dependency-json-null", 1);
			const rows = yield* session.run((db) =>
				db.execute<StreamKey & { sourceIndex: number; restart: null | boolean }>(
					sql`
					with definition_event_schema as (
						select d.id, d.entity_schema_id, d.slug, ${JSON.stringify({
							inputs: [
								{ eventSchemaSlug, scope: "entity" },
								{ through: null, eventSchemaSlug, scope: "entity" },
							],
						})}::jsonb as projection
						from definition_event_schema d
						join definition_entity_schema e on e.id = d.entity_schema_id
						where e.plugin_revision_id = ${source.fixture.pluginPin.revisionId} and d.slug = ${eventSchemaSlug}
					)
					select * from (${projectionDependencyTargets(projectionSources([source.key]))}) targets
				`,
					"objects",
				),
			);
			expect(rows).toEqual([{ ...source.key, sourceIndex: 0, restart: false }]);
		}),
	);

	test.effect("invalidates every mapped stream beyond one processor page", () =>
		Effect.gen(function* () {
			const restore = yield* BackupRestorePersistence.make;
			const session = yield* DatabaseSession;
			const parent = yield* seedStream("fanout-parent");
			const children = Array.from({ length: 101 }, (_, index) =>
				EntityId.make(`fanout-child-${index}`),
			);
			yield* session.transaction(
				Effect.gen(function* () {
					for (const child of children) {
						yield* restore.restoreEntity({
							userId,
							id: child,
							name: child,
							properties: {},
							entitySchemaSlug,
							entitySchemaPluginId: parent.fixture.pluginId,
						});
					}
					yield* restore.restoreEvents(
						children.map((child) =>
							dependencyInput(parent.fixture, {
								child,
								parent: parent.entityId,
								entityId: parent.entityId,
								id: `fanout-edge-${child}`,
							}),
						),
					);
				}),
			);
			const ids = children.map((entityId) =>
				eventStreamId({
					userId,
					entityId,
					eventSchemaSlug,
					eventSchemaPluginId: parent.fixture.pluginId,
				}),
			);
			const before = yield* session.run((db) =>
				db.select().from(tables.eventStream).where(inArray(tables.eventStream.id, ids)),
			);
			expect(before).toHaveLength(101);
			yield* seedAdjustment({ id: "fanout-source", entityId: parent.entityId });
			const after = yield* session.run((db) =>
				db.select().from(tables.eventStream).where(inArray(tables.eventStream.id, ids)),
			);
			expect(after).toHaveLength(101);
			for (const stream of before) {
				expect(after.find(({ id }) => id === stream.id)?.revision).toBe(stream.revision + 1);
			}
		}),
	);
});
