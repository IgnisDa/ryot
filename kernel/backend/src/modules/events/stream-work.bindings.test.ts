import { assert, expect, layer } from "@effect/vitest";
import { EVENT_STREAM_BATCH_LIMITS } from "@ryot-app/contract/modules/events/stream-work";
import {
	EntityId,
	EventId,
	PluginConfigRevisionId,
	PluginId,
} from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { EventsService } from "#modules/events/service";
import { eventStreamId, EventStreamRepository } from "#modules/events/stream-repository";
import { streamState } from "#modules/events/stream-repository.test-support";
import { EventStreamWorkService } from "#modules/events/stream-work";
import {
	accountToken,
	activeJob,
	adjustmentSchemaSlug,
	backgroundJob,
	command,
	entitySchemaSlug,
	eventSchemaSlug,
	fixturePackage,
	occurredAt,
	page,
	prepare,
	processNext,
	projection,
	ProjectionBindingControl,
	publish,
	seedRetainedTargets,
	seedStream,
	sourceState,
	startJob,
	StreamWorkControls,
	StreamWorkFixture,
	streamWorkTestLayer,
	summarySchemaSlug,
	userId,
} from "#modules/events/stream-work.test-support";
import { installRevisionPackage } from "#modules/plugins/packages/revision.test-support";
import { testPluginPackageId } from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

layer(streamWorkTestLayer)((test) => {
	test.effect(
		"rejects output from an old configuration binding and rebinds through reconciliation",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const bindings = yield* ProjectionBindingControl;
				const controls = yield* StreamWorkControls;
				const service = yield* EventStreamWorkService;
				const { id, eventId, fixture } = yield* seedStream("configuration-change");
				const [configuration] = yield* session.run((db) =>
					db
						.select()
						.from(tables.pluginConfigRevision)
						.where(eq(tables.pluginConfigRevision.id, fixture.pluginPin.configRevisionId)),
				);
				assert(configuration);
				const nextPin = {
					...fixture.pluginPin,
					configRevisionId: PluginConfigRevisionId.make(`${configuration.id}-rebound`),
				};
				yield* session.run((db) =>
					db
						.insert(tables.pluginConfigRevision)
						.values({ ...configuration, id: nextPin.configRevisionId }),
				);
				const job = yield* prepare(yield* startJob());
				yield* controls.setProcessor(id, () =>
					bindings
						.set({
							pluginPin: nextPin,
							accountGeneration: fixture.accountGeneration,
							principal: { ...fixture.principal, pluginRevision: nextPin },
						})
						.pipe(Effect.as({ ...page(eventId, 9, "old-binding"), done: true })),
				);
				yield* publish(job);
				expect(yield* projection(eventId)).toBeNull();
				expect(yield* backgroundJob(job.id)).toEqual({ error: null, status: "succeeded" });
				expect(yield* activeJob()).toEqual([]);
				yield* session.run((db) => db.delete(tables.eventStreamBinding));
				yield* service.reconcile();
				const rebound = yield* streamState(id);
				expect(rebound).toMatchObject({
					checkpoint: null,
					currentJobId: null,
					completedRevision: null,
				});
				expect(rebound?.pluginPin).toMatchObject({ configRevisionId: nextPin.configRevisionId });
				expect((yield* activeJob()).map(({ status }) => status)).toEqual(["running"]);
				yield* bindings.set(undefined);
			}),
	);
});

layer(streamWorkTestLayer)((test) => {
	test.effect(
		"reconciles more streams than one batch with set-based binding and continuations",
		() =>
			Effect.gen(function* () {
				const fixture = yield* StreamWorkFixture;
				const session = yield* DatabaseSession;
				const streams = yield* EventStreamRepository;
				const service = yield* EventStreamWorkService;
				const controls = yield* StreamWorkControls;
				const count = EVENT_STREAM_BATCH_LIMITS.streams + 50;
				const keys = Array.from({ length: count }, (_, index) => ({
					userId,
					eventSchemaSlug,
					eventSchemaPluginId: fixture.pluginId,
					entityId: EntityId.make(`bulk-${String(index).padStart(4, "0")}`),
				}));
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values(
							keys.map(({ entityId }) => ({
								userId,
								id: entityId,
								name: entityId,
								entitySchemaSlug,
								entitySchemaPluginId: fixture.pluginId,
							})),
						),
				);
				yield* session.transaction(streams.ensureStreams(keys));
				yield* service.reconcile();
				const ids = new Set(keys.map(eventStreamId));
				for (const id of ids) {
					expect((yield* streamState(id))?.accountToken).toBe(accountToken);
				}
				expect((yield* activeJob()).map(({ status }) => status)).toEqual(["running"]);
				const claimed = () =>
					controls.processorCalls.pipe(
						Effect.map((calls) => calls.filter(({ id }) => ids.has(id)).length),
					);
				yield* processNext();
				expect(yield* claimed()).toBe(EVENT_STREAM_BATCH_LIMITS.streams);
				expect((yield* activeJob()).map(({ status }) => status)).toEqual(["queued"]);
				yield* processNext();
				expect(yield* claimed()).toBe(count);
				expect(yield* activeJob()).toEqual([]);
			}),
	);

	test.effect("admits dirty schemas left without a job during reconciliation", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const streams = yield* EventStreamRepository;
			const service = yield* EventStreamWorkService;
			const controls = yield* StreamWorkControls;
			const source = yield* seedStream("reconcile-dirty");
			yield* processNext();
			yield* session.transaction(
				streams.touch([
					{
						userId,
						occurredAt,
						eventSchemaSlug,
						entityId: source.entityId,
						eventSchemaPluginId: source.fixture.pluginId,
					},
				]),
			);
			expect(yield* activeJob()).toEqual([]);
			const callsBefore = (yield* controls.workflowCalls).length;
			yield* service.reconcile();
			const [admitted] = yield* activeJob();
			assert(admitted);
			expect(
				(yield* controls.workflowCalls)
					.slice(callsBefore)
					.filter(({ executionId }) => executionId === admitted.id),
			).toEqual([expect.objectContaining({ inTransaction: false, payload: { id: admitted.id } })]);
			yield* service.reconcile();
			expect(yield* activeJob()).toEqual([admitted]);
			yield* processNext();
			expect(yield* activeJob()).toEqual([]);
		}),
	);

	test.effect(
		"leaves optional unavailable bindings pending without rejecting their source writes",
		() =>
			Effect.gen(function* () {
				const source = yield* seedStream("admission-binding-unavailable");
				const bindings = yield* ProjectionBindingControl;
				const events = yield* EventsService;
				yield* processNext();
				yield* bindings.set(null);
				yield* events
					.edit(
						{ eventId: source.eventId, patch: { properties: { remove: [], set: { rating: 2 } } } },
						userId,
						command("admission-unavailable-edit"),
					)
					.pipe(Effect.ensuring(bindings.set(undefined)));
				expect((yield* sourceState(source.eventId))?.properties).toEqual({ rating: 2 });
				const pending = yield* streamState(source.id);
				expect(pending?.completedRevision).not.toBe(pending?.streamRevision);
				expect(yield* activeJob()).toEqual([]);
				yield* events.edit(
					{ eventId: source.eventId, patch: { properties: { remove: [], set: { rating: 3 } } } },
					userId,
					command("admission-healthy-edit"),
				);
				expect((yield* activeJob()).map(({ status }) => status)).toEqual(["running"]);
				yield* processNext();
			}),
	);

	test.effect("rebuilds source-only restored streams through declaration reconciliation", () =>
		Effect.gen(function* () {
			const restore = yield* BackupRestorePersistence.make;
			const fixture = yield* StreamWorkFixture;
			const session = yield* DatabaseSession;
			const service = yield* EventStreamWorkService;
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const entityId = EntityId.make("restored-projection-entity");
			const eventId = EventId.make("restored-projection-source");
			yield* session.transaction(
				Effect.gen(function* () {
					yield* restore.restoreEntity({
						userId,
						id: entityId,
						properties: {},
						entitySchemaSlug,
						name: "Restored entity",
						entitySchemaPluginId: fixture.pluginId,
					});
					yield* restore.restoreEvents([
						{
							userId,
							entityId,
							occurredAt,
							id: eventId,
							eventSchemaSlug,
							properties: { rating: 4 },
							orderKey: "retained-order",
							orderCreatedAt: occurredAt,
							eventSchemaPluginId: fixture.pluginId,
						},
						{
							userId,
							entityId,
							occurredAt,
							properties: { value: 2 },
							id: "restored-projection-adjustment",
							eventSchemaSlug: adjustmentSchemaSlug,
							eventSchemaPluginId: fixture.pluginId,
						},
					]);
				}),
			);
			const id = eventStreamId({
				userId,
				entityId,
				eventSchemaSlug,
				eventSchemaPluginId: fixture.pluginId,
			});
			expect((yield* streamState(id))?.accountToken).toBeNull();
			const source = yield* sourceState(eventId);
			yield* service.reconcile();
			expect(yield* streamState(id)).toMatchObject({ accountToken, checkpoint: null });
			expect((yield* activeJob()).map(({ status }) => status)).toEqual(["running"]);
			yield* controls.setProcessor(id, () =>
				Effect.succeed({ ...page(eventId, 6, "rebuilt"), done: true }),
			);
			yield* processNext();
			yield* service.reconcile();
			expect(yield* projection(eventId)).toEqual({ properties: { score: 6 } });
			expect(yield* sourceState(eventId)).toEqual(source);
			const complete = yield* streamState(id);
			expect(complete?.completedRevision).toBe(complete?.streamRevision);
			expect(
				(yield* streams.bindingDeclarations({ limit: 100 })).filter(
					(declaration) => declaration.eventSchemaPluginId === fixture.pluginId,
				),
			).toEqual([]);
		}),
	);

	test.effect(
		"keeps unavailable bindings pending and binds them once the plugin is executable",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const service = yield* EventStreamWorkService;
				const initial = fixturePackage();
				const independent = {
					...initial,
					manifest: {
						...initial.manifest,
						metadata: { ...initial.manifest.metadata, packageId: testPluginPackageId() },
					},
				};
				const installed = yield* installRevisionPackage(independent);
				const pluginId = PluginId.make(installed.pluginId);
				const entityId = EntityId.make("late-declaration-target");
				const eventId = EventId.make("late-declaration-retained-input");
				const key = { userId, entityId, eventSchemaSlug, eventSchemaPluginId: pluginId };
				const id = eventStreamId(key);
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values({
							userId,
							id: entityId,
							name: entityId,
							entitySchemaSlug,
							entitySchemaPluginId: pluginId,
						}),
				);
				yield* session.run((db) =>
					db
						.insert(tables.event)
						.values({
							userId,
							entityId,
							occurredAt,
							id: eventId,
							properties: { value: 3 },
							sessionEntityId: entityId,
							eventSchemaPluginId: pluginId,
							eventSchemaSlug: adjustmentSchemaSlug,
						}),
				);
				yield* session.run((db) => db.insert(tables.eventStream).values({ ...key, id }));
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ health: "installing" })
						.where(eq(tables.pluginInstallation.pluginId, pluginId)),
				);
				const healthy = yield* seedRetainedTargets("unavailable-binding-healthy", 1);
				yield* session.run((db) =>
					db.insert(tables.eventStream).values({ ...healthy.key, id: healthy.id }),
				);
				yield* session.run((db) => db.delete(tables.eventStreamBinding));
				const facts = yield* sourceState(eventId);
				yield* service.reconcile();
				expect((yield* streamState(id))?.accountToken).toBeNull();
				expect((yield* streamState(healthy.id))?.accountToken).toBe(accountToken);
				const replacement = yield* installRevisionPackage({
					...independent,
					contentHash: "stream-fixture-replacement",
				});
				expect(replacement.pluginId).toBe(pluginId);
				yield* service.reconcile();
				const rebound = yield* streamState(id);
				expect(rebound).toMatchObject({
					accountToken,
					checkpoint: null,
					completedRevision: null,
					pluginRevisionId: replacement.revisionId,
				});
				expect(yield* sourceState(eventId)).toEqual(facts);
				yield* service.reconcile();
				expect(yield* streamState(id)).toEqual(rebound);
			}),
	);
});

layer(streamWorkTestLayer)((test) => {
	test.effect("pages binding declarations past declarations that stay unrecorded", () =>
		Effect.gen(function* () {
			const streams = yield* EventStreamRepository;
			const [first] = yield* streams.bindingDeclarations({ limit: 1 });
			assert(first);
			const [second] = yield* streams.bindingDeclarations({ limit: 1, after: first });
			expect([first.eventSchemaSlug, second?.eventSchemaSlug]).toEqual([
				eventSchemaSlug,
				summarySchemaSlug,
			]);
		}),
	);

	test.effect("keeps a declaration stale when a stream is created after it was read", () =>
		Effect.gen(function* () {
			const fixture = yield* StreamWorkFixture;
			const session = yield* DatabaseSession;
			const streams = yield* EventStreamRepository;
			const service = yield* EventStreamWorkService;
			const declarations = streams
				.bindingDeclarations({ limit: 100 })
				.pipe(
					Effect.map((rows) =>
						rows.filter(
							(row) =>
								row.eventSchemaPluginId === fixture.pluginId &&
								row.eventSchemaSlug === eventSchemaSlug,
						),
					),
				);
			yield* service.reconcile();
			const first = yield* seedRetainedTargets("binding-race-first", 0);
			yield* session.transaction(streams.lock([first.key]));
			const [read] = yield* declarations;
			assert(read);
			const second = yield* seedRetainedTargets("binding-race-second", 0);
			yield* session.transaction(streams.lock([second.key]));
			const { projection: _, ...declaration } = read;
			yield* streams.recordBinding(declaration);
			expect((yield* declarations).map(({ revision }) => revision)).toEqual([read.revision + 1]);
			yield* service.reconcile();
			expect((yield* streamState(second.id))?.accountToken).toBe(fixture.accountGeneration.token);
			expect(yield* declarations).toEqual([]);
		}),
	);
});
