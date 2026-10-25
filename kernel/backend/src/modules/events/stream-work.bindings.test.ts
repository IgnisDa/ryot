import { assert, expect, layer } from "@effect/vitest";
import {
	EntityId,
	EventId,
	PluginConfigRevisionId,
	PluginId,
	SandboxScriptId,
} from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { BackgroundWorkService, BackgroundWorkWorkflow } from "#modules/background-work/service";
import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { EventsService } from "#modules/events/service";
import { eventStreamId, EventStreamRepository } from "#modules/events/stream-repository";
import { EventStreamWorkService } from "#modules/events/stream-work";
import {
	accountToken,
	adjustmentSchemaSlug,
	backgroundJob,
	command,
	entitySchemaSlug,
	eventSchemaSlug,
	fixturePackage,
	occurredAt,
	page,
	processCurrent,
	projection,
	ProjectionBindingControl,
	seedRetainedTargets,
	seedStream,
	sourceState,
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
		"rejects output from an old configuration binding and admits the current processor",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const bindings = yield* ProjectionBindingControl;
				const controls = yield* StreamWorkControls;
				const streams = yield* EventStreamRepository;
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
				yield* controls.setProcessor(id, () =>
					bindings
						.set({
							pluginPin: nextPin,
							accountGeneration: fixture.accountGeneration,
							principal: { ...fixture.principal, pluginRevision: nextPin },
						})
						.pipe(Effect.as({ ...page(eventId, 9, "old-binding"), done: true })),
				);
				const oldJob = yield* processCurrent(id);
				expect(yield* projection(eventId)).toBeNull();
				expect(yield* backgroundJob(oldJob.id)).toEqual({ error: null, status: "succeeded" });
				const rebound = yield* streams.get(id);
				assert(rebound?.currentJobId);
				expect(rebound.currentJobId).not.toBe(oldJob.id);
				expect(rebound).toMatchObject({
					status: "queued",
					checkpoint: null,
					completedRevision: null,
				});
				expect(rebound.pluginPin).toMatchObject({ configRevisionId: nextPin.configRevisionId });
				yield* bindings.set(undefined);
			}),
	);

	test.effect("continues reconciliation after a failed admission", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const background = yield* BackgroundWorkService;
			const streams = yield* EventStreamRepository;
			const controls = yield* StreamWorkControls;
			const session = yield* DatabaseSession;
			const failed = yield* seedStream("reconcile-unavailable-processor");
			const healthy = yield* seedStream("reconcile-healthy-processor");
			const failedBefore = yield* streams.get(failed.id);
			const healthyBefore = yield* streams.get(healthy.id);
			assert(failedBefore?.currentJobId);
			assert(healthyBefore?.currentJobId);
			const healthyBeforeJobId = healthyBefore.currentJobId;

			const restoreRows = Effect.gen(function* () {
				yield* session.run((db) =>
					db
						.update(tables.eventStreamWork)
						.set({
							step: failedBefore.step,
							updatedAt: failedBefore.updatedAt,
							currentJobId: failedBefore.currentJobId,
							processorScriptId: failedBefore.processorScriptId,
						})
						.where(eq(tables.eventStreamWork.id, failed.id)),
				);
				yield* session.run((db) =>
					db
						.update(tables.eventStreamWork)
						.set({
							step: healthyBefore.step,
							updatedAt: healthyBefore.updatedAt,
							currentJobId: healthyBefore.currentJobId,
							processorScriptId: healthyBefore.processorScriptId,
						})
						.where(eq(tables.eventStreamWork.id, healthy.id)),
				);
			});
			const beforeAdmissionCalls = yield* controls.admissionCalls;
			const beforeWorkflowCalls = yield* controls.workflowCalls;
			const reconciliation = Effect.gen(function* () {
				yield* background.finish({ userId, id: healthyBeforeJobId }, "succeeded");
				yield* session.run((db) =>
					db
						.update(tables.eventStreamWork)
						.set({
							currentJobId: null,
							processorScriptId: SandboxScriptId.make("missing-stream-processor"),
						})
						.where(eq(tables.eventStreamWork.id, failed.id)),
				);
				yield* session.run((db) =>
					db
						.update(tables.eventStreamWork)
						.set({ currentJobId: null })
						.where(eq(tables.eventStreamWork.id, healthy.id)),
				);
				yield* service.reconcile();

				const failedAfter = yield* streams.get(failed.id);
				const healthyAfter = yield* streams.get(healthy.id);
				assert(failedAfter);
				assert(healthyAfter?.currentJobId);
				expect(failedAfter.currentJobId).toBeNull();
				expect(failedAfter.processorScriptId).toBe("missing-stream-processor");
				expect(yield* backgroundJob(healthyAfter.currentJobId)).toEqual({
					error: null,
					status: "running",
				});

				const admissionCalls = (yield* controls.admissionCalls).slice(beforeAdmissionCalls.length);
				for (const id of [failed.id, healthy.id]) {
					const index = admissionCalls.findIndex(
						(call) => call.operation === "prepare" && call.id === id,
					);
					expect(index).toBeGreaterThan(0);
					expect(admissionCalls[index - 1]).toEqual({
						inTransaction: true,
						operation: "lockAccount",
					});
					expect(admissionCalls[index]).toEqual({ id, inTransaction: true, operation: "prepare" });
				}
				const dispatches = (yield* controls.workflowCalls)
					.slice(beforeWorkflowCalls.length)
					.filter((call) => call.executionId === healthyAfter.currentJobId);
				expect(dispatches).toHaveLength(1);
				expect(dispatches[0]).toMatchObject({
					inTransaction: false,
					name: BackgroundWorkWorkflow._tag,
					executionId: healthyAfter.currentJobId,
					payload: { id: healthyAfter.currentJobId },
				});
			});

			yield* reconciliation.pipe(Effect.ensuring(restoreRows.pipe(Effect.orDie)));
		}),
	);

	test.effect(
		"leaves optional unavailable bindings pending without rejecting their source writes",
		() =>
			Effect.gen(function* () {
				const source = yield* seedStream("admission-binding-unavailable");
				const healthy = yield* seedStream("admission-binding-healthy");
				const streams = yield* EventStreamRepository;
				const bindings = yield* ProjectionBindingControl;
				const events = yield* EventsService;
				const controls = yield* StreamWorkControls;
				yield* controls.setProcessor(source.id, () =>
					Effect.succeed({ done: true, updates: [], checkpoint: null }),
				);
				const completed = yield* processCurrent(source.id);
				yield* bindings.set(null);
				yield* events
					.edit(
						{ eventId: source.eventId, patch: { properties: { remove: [], set: { rating: 2 } } } },
						userId,
						command("admission-unavailable-edit"),
					)
					.pipe(Effect.ensuring(bindings.set(undefined)));
				expect((yield* sourceState(source.eventId))?.properties).toEqual({ rating: 2 });
				const pending = yield* streams.get(source.id);
				assert(pending);
				expect(pending.currentJobId).toBeNull();
				expect(pending.completedRevision).not.toBe(pending.streamRevision);
				expect(yield* backgroundJob(completed.id)).toEqual({ error: null, status: "succeeded" });
				const before = yield* streams.get(healthy.id);
				assert(before?.currentJobId);
				yield* events.edit(
					{ eventId: healthy.eventId, patch: { properties: { remove: [], set: { rating: 2 } } } },
					userId,
					command("admission-healthy-edit"),
				);
				expect((yield* streams.get(healthy.id))?.currentJobId).not.toBe(before.currentJobId);
				expect((yield* streams.get(healthy.id))?.currentJobId).not.toBeNull();
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
			expect(yield* streams.get(id)).toBeNull();
			const source = yield* sourceState(eventId);
			yield* service.reconcile();
			const rebuilt = yield* streams.get(id);
			expect(rebuilt?.checkpoint).toBeNull();
			expect(rebuilt?.accountToken).toBe(accountToken);
			yield* controls.setProcessor(id, () =>
				Effect.succeed({ ...page(eventId, 6, "rebuilt"), done: true }),
			);
			yield* processCurrent(id);
			yield* service.reconcile();
			expect(yield* projection(eventId)).toEqual({ properties: { score: 6 } });
			expect(yield* sourceState(eventId)).toEqual(source);
			const complete = yield* streams.get(id);
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
				const streams = yield* EventStreamRepository;
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
				expect(yield* streams.get(id)).toBeNull();
				const healthyWork = yield* streams.get(healthy.id);
				assert(healthyWork?.currentJobId);
				const replacement = yield* installRevisionPackage({
					...independent,
					contentHash: "stream-fixture-replacement",
				});
				expect(replacement.pluginId).toBe(pluginId);
				yield* service.reconcile();
				const rebound = yield* streams.get(id);
				assert(rebound?.currentJobId);
				expect(rebound.pluginRevisionId).toBe(replacement.revisionId);
				expect(rebound.accountToken).toBe(accountToken);
				expect(rebound.checkpoint).toBeNull();
				expect(rebound.completedRevision).toBeNull();
				expect(yield* sourceState(eventId)).toEqual(facts);
				yield* service.reconcile();
				expect((yield* streams.get(id))?.currentJobId).toBe(rebound.currentJobId);
				expect((yield* streams.get(id))?.streamRevision).toBe(rebound.streamRevision);
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
			expect((yield* streams.get(second.id))?.currentJobId).toEqual(expect.any(String));
			expect(yield* declarations).toEqual([]);
		}),
	);
});
