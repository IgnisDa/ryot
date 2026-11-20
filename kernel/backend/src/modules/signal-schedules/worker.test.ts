import { describe, expect, it } from "bun:test";

import { EntityId, EntitySchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { TimeZone, UTC } from "@ryot-app/contract/schema/time-zone";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import { column, field, table } from "@ryot-app/ryotql";
import { assert } from "@ryot-app/testing/assert";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Ref } from "effect";

import { LifecyclePlannerServiceLive } from "#modules/automations/layer";
import {
	noLifecycleWorkLayer,
	noPoliciesLayer,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { userDataChangeSets } from "#modules/changes/change-sets.test-support";
import { ChangeSets } from "#modules/changes/service";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntityUserDataService } from "#modules/entities/user-data/service";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { EventsRepository } from "#modules/events/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RyotQLService } from "#modules/ryotql/service";
import { DatabaseSession } from "#platform/db/session";
import { EntitlementService, entitlementServiceFrom } from "#platform/entitlements";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";

import { SignalScheduleRepository } from "./repository";
import { signalScheduleBounds, SignalScheduleWorker } from "./worker";

const now = new Date("2026-10-29T02:30:00.000Z");

describe("signal schedule bounds", () => {
	it("covers the recipient's local day and two catch-up days for dates", () => {
		expect(
			signalScheduleBounds({
				now,
				delayDays: null,
				precision: "date",
				maxAgeHours: null,
				timeZone: TimeZone.make("UTC"),
			}),
		).toEqual({
			confirmedAfter: null,
			end: "2026-10-30T00:00:00.000Z",
			start: "2026-10-27T00:00:00.000Z",
		});
		expect(
			signalScheduleBounds({
				now,
				delayDays: null,
				maxAgeHours: 72,
				precision: "date",
				timeZone: TimeZone.make("America/Los_Angeles"),
			}),
		).toEqual({
			end: "2026-10-29T00:00:00.000Z",
			start: "2026-10-26T00:00:00.000Z",
			confirmedAfter: "2026-10-26T02:30:00.000Z",
		});
	});

	it("bounds instants by local midnight two days back and the current instant", () => {
		expect(
			signalScheduleBounds({
				now,
				delayDays: null,
				maxAgeHours: null,
				precision: "instant",
				timeZone: TimeZone.make("Asia/Kolkata"),
			}),
		).toEqual({
			confirmedAfter: null,
			end: "2026-10-29T02:30:00.001Z",
			start: "2026-10-26T18:30:00.000Z",
		});
	});

	it("shifts the window back by the declared delay", () => {
		expect(
			signalScheduleBounds({
				now,
				delayDays: 7,
				maxAgeHours: null,
				precision: "instant",
				timeZone: TimeZone.make("UTC"),
			}),
		).toEqual({
			confirmedAfter: null,
			end: "2026-10-22T02:30:00.001Z",
			start: "2026-10-20T00:00:00.000Z",
		});
	});
});

class DispatchedTriggers extends Context.Service<
	DispatchedTriggers,
	Effect.Effect<ReadonlyArray<string>>
>()("@ryot-app/kernel-backend/modules/signal-schedules/worker.test/DispatchedTriggers") {}

const execution = Layer.effectContext(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const dispatched = yield* Ref.make<ReadonlyArray<string>>([]);
		return Context.make(
			LifecycleExecution,
			withLifecycleDispatch(
				{ after: ({ triggerId }) => Ref.update(dispatched, (all) => [...all, triggerId]) },
				session,
			),
		).pipe(Context.add(DispatchedTriggers, Ref.get(dispatched)));
	}),
);

const owner = UserId.make("owner");
const subjectId = EntityId.make("schedule-subject");
const subject = table("entity", "subject");

const services = Layer.unwrap(
	Effect.gen(function* () {
		const installed = yield* installRevisionPackage(revisionPackage(), owner);
		const session = yield* DatabaseSession;
		yield* session.transaction(
			Effect.gen(function* () {
				yield* (yield* DefinitionRepository).replaceKernelDefinitions(kernelDefinitionSource());
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values({
							userId: owner,
							id: subjectId,
							name: "Subject",
							entitySchemaPluginId: null,
							entitySchemaSlug: "collection",
						}),
				);
			}),
		);
		const repository = yield* SignalScheduleRepository.make;
		const target: Effect.Success<ReturnType<typeof repository.listTargets>>[number] = {
			userId: owner,
			dueAt: "dueAt",
			properties: {},
			delayDays: null,
			freshness: null,
			slug: "schedule",
			entitlement: null,
			occurrence: "occurrence",
			signal: "fixture.signal",
			pluginId: installed.pluginId,
			precision: "instant" as const,
			subject: {
				entityAlias: "subject",
				schemas: [
					{ owner: { kind: "kernel" as const }, slug: EntitySchemaSlug.make("collection") },
				],
			},
			preferences: {
				weekStart: null,
				interfaceLocale: null,
				contentLanguage: null,
				reportingTimeZone: UTC,
				disableIntegrations: false,
				ratingScale: "hundred" as const,
			},
			query: {
				from: subject,
				output: {
					type: "rows" as const,
					fields: [
						field("dueAt", column(subject, "createdAt")),
						field("occurrence", column(subject, "id")),
					],
				},
			},
		};
		return SignalScheduleWorker.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(SignalScheduleRepository, {
						...repository,
						listTargets: () => Effect.succeed([target]),
						listDelivered: () => Effect.succeed(new Set<string>()),
					}),
					Layer.mock(RyotQLService)({
						executeForUser: () =>
							Effect.succeed({
								execution: { now: 0, weekStart: 1, timeZone: UTC },
								data: {
									signalScheduleDue: {
										type: "rows",
										pageInfo: { limit: 100, hasMore: false, nextCursor: null },
										items: [{ __scheduleOccurrence: "once", __scheduleSubjectId: subjectId }],
									},
								},
							}),
					}),
					Layer.succeed(EntitlementService, entitlementServiceFrom(Effect.succeed([]))),
				),
			),
		);
	}),
).pipe(
	Layer.provideMerge(Layer.effect(ChangeSets, userDataChangeSets())),
	Layer.provideMerge(
		SignalEmissionService.layer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					LifecyclePlannerServiceLive.pipe(Layer.provide(noLifecycleWorkLayer)),
					noPoliciesLayer,
					DomainWriteChecksLive,
					EventSchemaReader.layer,
					Layer.mock(EntityUserDataService)({}),
				),
			),
			Layer.provideMerge(execution),
			Layer.provideMerge(
				Layer.mergeAll(
					AutomationTriggerRepository.layer,
					EntitiesRepository.layer,
					RelationshipsRepository.layer,
					EventsRepository.layer,
				),
			),
			Layer.provideMerge(revisionDatabaseLayer),
			Layer.provideMerge(makeAppConfigLayer()),
		),
	),
);

layer(services)((test) => {
	test.effect("delivers an occurrence another run already recorded at most once", () =>
		Effect.gen(function* () {
			const worker = yield* SignalScheduleWorker;
			yield* worker.run();
			yield* worker.run();
			const session = yield* DatabaseSession;
			const deliveries = yield* session.run((db) =>
				db
					.select()
					.from(tables.signalScheduleDelivery)
					.where(eq(tables.signalScheduleDelivery.userId, owner)),
			);
			const triggers = yield* session.run((db) =>
				db
					.select({ id: tables.automationTrigger.id })
					.from(tables.automationTrigger)
					.where(eq(tables.automationTrigger.resourceKind, "signal")),
			);
			const [delivery, ...others] = deliveries;
			assert(delivery);
			expect({ others, occurrence: delivery.occurrenceKey }).toEqual({
				others: [],
				occurrence: "once",
			});
			expect(triggers.map(({ id }) => id)).toEqual([delivery.triggerId]);
			expect(yield* yield* DispatchedTriggers).toEqual([delivery.triggerId]);
		}),
	);
});
