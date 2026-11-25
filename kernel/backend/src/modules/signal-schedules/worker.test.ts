import { describe, expect, it } from "bun:test";

import type { PluginSignalSchedule } from "@ryot-app/contract/modules/plugins/manifest";
import { EntitySchemaSlug, SignalSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import { castDate, column, field, jsonPath, table } from "@ryot-app/ryotql";
import { assert } from "@ryot-app/testing/assert";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, inArray, sql } from "drizzle-orm";
import { Context, Deferred, Effect, Fiber, Layer, Ref, References } from "effect";
import { TestClock } from "effect/testing";

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
import {
	signalScheduleBounds,
	signalScheduleDueFrom,
	signalScheduleNextDue,
	SignalScheduleWorker,
} from "./worker";

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

describe("signal schedule due times", () => {
	it.each([
		{ delayDays: 7, precision: "date", dueAt: "2026-10-22", timeZone: "America/Los_Angeles" },
		{ delayDays: null, precision: "date", dueAt: "2026-10-30", timeZone: "Asia/Kolkata" },
		{ delayDays: 2, timeZone: "UTC", precision: "instant", dueAt: "2026-10-29T02:30:00.000Z" },
	] as const)("starts at the first window that holds a $precision due time", (input) => {
		const dueAt = new Date(input.dueAt);
		const timeZone = TimeZone.make(input.timeZone);
		const from = signalScheduleDueFrom({ ...input, timeZone });
		const end = (at: Date) =>
			new Date(
				signalScheduleBounds({ ...input, now: at, timeZone, maxAgeHours: null }).end,
			).getTime();
		expect(end(from)).toBeGreaterThan(dueAt.getTime());
		expect(end(new Date(from.getTime() - 1))).toBeLessThanOrEqual(dueAt.getTime());
	});
});

describe("signal schedule next due time", () => {
	const timeZone = TimeZone.make("Asia/Kolkata");
	it.each([
		{
			next: "2026-11-01",
			due: "2026-10-31T18:30:00.000Z",
			nextInstant: "2026-10-31T20:00:00.000Z",
		},
		{
			next: "2026-11-01",
			due: "2026-10-31T17:00:00.000Z",
			nextInstant: "2026-10-31T17:00:00.000Z",
		},
		{ next: null, due: "2026-10-31T17:00:00.000Z", nextInstant: "2026-10-31T17:00:00.000Z" },
		{ nextInstant: null, next: "2026-11-01", due: "2026-10-31T18:30:00.000Z" },
		{ due: null, next: null, nextInstant: null },
	])("is the earlier of the next date $next and the next instant $nextInstant", (input) => {
		expect(
			signalScheduleNextDue({
				...input,
				timeZone,
				delayDays: null,
				precision: "date",
			})?.toISOString() ?? null,
		).toBe(input.due);
	});
});

const failingUser = "failing-";

class ScheduleQueries extends Context.Service<ScheduleQueries, Effect.Effect<number>>()(
	"@ryot-app/kernel-backend/modules/signal-schedules/worker.test/ScheduleQueries",
) {}

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

const recordedQueries = Layer.effectContext(
	Effect.gen(function* () {
		const ryotql = yield* RyotQLService;
		const executions = yield* Ref.make(0);
		return Context.make(RyotQLService, {
			...ryotql,
			executeForUser: (...input: Parameters<typeof ryotql.executeForUser>) =>
				Ref.update(executions, (count) => count + 1).pipe(
					Effect.andThen(
						input[0].startsWith(failingUser)
							? Effect.die(new Error("Query unavailable"))
							: ryotql.executeForUser(...input),
					),
				),
		}).pipe(Context.add(ScheduleQueries, Ref.getAndSet(executions, 0)));
	}),
).pipe(Layer.provide(RyotQLService.layer));

const owner = UserId.make("owner");
const subject = table("entity", "subject");
const schedule: PluginSignalSchedule = {
	properties: {},
	dueAt: "dueAt",
	slug: "schedule",
	precision: "instant",
	occurrence: "occurrence",
	signal: SignalSchemaSlug.make("fixture.signal"),
	subject: {
		entityAlias: "subject",
		schemas: [{ owner: { kind: "self" }, slug: EntitySchemaSlug.make("fixture-entity") }],
	},
	query: {
		from: subject,
		output: {
			type: "rows",
			fields: [
				field("dueAt", castDate(jsonPath(column(subject, "properties"), "dueAt"))),
				field("occurrence", column(subject, "id")),
			],
		},
	},
};

class Fixture extends Context.Service<Fixture, { readonly pluginId: string }>()(
	"@ryot-app/kernel-backend/modules/signal-schedules/worker.test/Fixture",
) {}

const fixture = Layer.effect(
	Fixture,
	Effect.gen(function* () {
		const plugin = revisionPackage();
		const { pluginId } = yield* installRevisionPackage({
			...plugin,
			manifest: {
				...plugin.manifest,
				signalSchedules: [schedule, { ...schedule, entitlement: "pro", slug: "pro-schedule" }],
			},
		});
		const session = yield* DatabaseSession;
		yield* (yield* DefinitionRepository).replaceKernelDefinitions(kernelDefinitionSource());
		yield* session.run((db) =>
			db
				.insert(tables.notificationSubscription)
				.values({
					userId: owner,
					signalSchemaPluginId: pluginId,
					signalSchemaSlug: "fixture.signal",
				}),
		);
		return { pluginId };
	}),
);

const services = SignalScheduleWorker.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			fixture,
			recordedQueries,
			SignalScheduleRepository.layer,
			Layer.succeed(EntitlementService, entitlementServiceFrom(Effect.succeed([]))),
		),
	),
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

const start = new Date("2026-10-29T12:00:00.000Z").getTime();
const hours = (count: number) => count * 3_600_000;

const reset = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) => db.delete(tables.signalScheduleEvaluation));
	yield* session.run((db) => db.delete(tables.signalScheduleDelivery));
	yield* session.run((db) => db.delete(tables.automationTrigger));
	yield* session.run((db) => db.delete(tables.entity));
});

const insertEntity = Effect.fn(function* (
	id: string,
	dueAt: number,
	userId: null | UserId = owner,
	entitySchemaSlug: EntitySchemaSlug = EntitySchemaSlug.make("fixture-entity"),
) {
	const { pluginId } = yield* Fixture;
	yield* (yield* DatabaseSession).run((db) =>
		db
			.insert(tables.entity)
			.values({
				id,
				userId,
				name: id,
				entitySchemaSlug,
				entitySchemaPluginId: pluginId,
				properties: { dueAt: new Date(dueAt).toISOString() },
			}),
	);
});

const runAt = Effect.fn(function* (at: number) {
	yield* TestClock.setTime(at);
	yield* (yield* SignalScheduleWorker).run();
	const session = yield* DatabaseSession;
	const deliveries = yield* session.run((db) =>
		db
			.select({ occurrence: tables.signalScheduleDelivery.occurrenceKey })
			.from(tables.signalScheduleDelivery)
			.where(eq(tables.signalScheduleDelivery.userId, owner))
			.orderBy(tables.signalScheduleDelivery.occurrenceKey),
	);
	return {
		queries: yield* yield* ScheduleQueries,
		delivered: deliveries.map(({ occurrence }) => occurrence),
	};
});

// On the test clock, the connection pool's idle reaper would wake once a minute from 1970 to `start`.
layer(Layer.effectContext(TestClock.withLive(Layer.build(services))))((test) => {
	test.effect("skips an unchanged target until its next occurrence is due", () =>
		Effect.gen(function* () {
			yield* reset;
			yield* insertEntity("past", start - hours(1));
			yield* insertEntity("soon", start + hours(2));
			expect(yield* runAt(start)).toEqual({ queries: 1, delivered: ["past"] });
			expect(yield* runAt(start + hours(1))).toEqual({ queries: 0, delivered: ["past"] });
			expect(yield* runAt(start + hours(3))).toEqual({ queries: 1, delivered: ["past", "soon"] });
			expect(yield* runAt(start + hours(4))).toEqual({ queries: 0, delivered: ["past", "soon"] });
		}),
	);

	test.effect("evaluates again after its user's data changes and delivers once", () =>
		Effect.gen(function* () {
			yield* reset;
			const session = yield* DatabaseSession;
			const earlier = (yield* yield* DispatchedTriggers).length;
			yield* insertEntity("first", start - hours(1));
			expect(yield* runAt(start)).toEqual({ queries: 1, delivered: ["first"] });
			yield* session.run((db) =>
				db
					.update(tables.entity)
					.set({ properties: { dueAt: new Date(start - hours(2)).toISOString() } })
					.where(eq(tables.entity.id, "first")),
			);
			yield* insertEntity("second", start - hours(1));
			expect(yield* runAt(start + 60_000)).toEqual({ queries: 1, delivered: ["first", "second"] });
			const deliveries = yield* session.run((db) =>
				db
					.select({ triggerId: tables.signalScheduleDelivery.triggerId })
					.from(tables.signalScheduleDelivery),
			);
			const triggers = yield* session.run((db) =>
				db
					.select({ id: tables.automationTrigger.id })
					.from(tables.automationTrigger)
					.where(eq(tables.automationTrigger.resourceKind, "signal")),
			);
			const delivered = new Set(deliveries.map(({ triggerId }) => triggerId));
			expect(triggers).toHaveLength(2);
			expect(new Set(triggers.map(({ id }) => id))).toEqual(delivered);
			const dispatched = (yield* yield* DispatchedTriggers).slice(earlier);
			expect(dispatched).toHaveLength(2);
			expect(new Set(dispatched)).toEqual(delivered);
		}),
	);

	test.effect("evaluates again after a change to global data but not to another user's", () =>
		Effect.gen(function* () {
			yield* reset;
			expect(yield* runAt(start)).toEqual({ queries: 1, delivered: [] });
			yield* insertEntity("foreign", start - hours(1), UserId.make("recipient"));
			expect(yield* runAt(start + 60_000)).toEqual({ queries: 0, delivered: [] });
			yield* insertEntity("global", start + hours(48), null);
			expect(yield* runAt(start + 120_000)).toEqual({ queries: 1, delivered: [] });
		}),
	);

	test.effect("skips a change to global data of a schema the schedule does not read", () =>
		Effect.gen(function* () {
			yield* reset;
			expect(yield* runAt(start)).toEqual({ queries: 1, delivered: [] });
			yield* insertEntity(
				"unrelated",
				start - hours(1),
				null,
				EntitySchemaSlug.make("unrelated-entity"),
			);
			expect(yield* runAt(start + 60_000)).toEqual({ queries: 0, delivered: [] });
		}),
	);

	test.effect("evaluates again after its plugin or installation changes", () =>
		Effect.gen(function* () {
			yield* reset;
			const { pluginId } = yield* Fixture;
			const session = yield* DatabaseSession;
			expect(yield* runAt(start)).toEqual({ queries: 1, delivered: [] });
			yield* session.run((db) =>
				db.update(tables.plugin).set({ status: "active" }).where(eq(tables.plugin.id, pluginId)),
			);
			expect(yield* runAt(start + 60_000)).toEqual({ queries: 1, delivered: [] });
			yield* session.run((db) =>
				db
					.update(tables.pluginInstallation)
					.set({ sortOrder: 1 })
					.where(eq(tables.pluginInstallation.userId, owner)),
			);
			expect(yield* runAt(start + 120_000)).toEqual({ queries: 1, delivered: [] });
			expect(yield* runAt(start + 180_000)).toEqual({ queries: 0, delivered: [] });
		}),
	);

	test.effect("keeps an unchanged evaluation without refreshing it and advances its snapshot", () =>
		Effect.gen(function* () {
			yield* reset;
			const session = yield* DatabaseSession;
			const evaluated = session.run((db) =>
				db
					.select({
						evaluatedAt: tables.signalScheduleEvaluation.evaluatedAt,
						snapshot: sql<string>`${tables.signalScheduleEvaluation.snapshot}::text`,
					})
					.from(tables.signalScheduleEvaluation),
			);
			expect(yield* runAt(start)).toEqual({ queries: 1, delivered: [] });
			const [first] = yield* evaluated;
			assert(first);
			yield* insertEntity(
				"unrelated",
				start - hours(1),
				null,
				EntitySchemaSlug.make("unrelated-entity"),
			);
			expect(yield* runAt(start + 60_000)).toEqual({ queries: 0, delivered: [] });
			expect(yield* evaluated).toEqual([first]);
			expect(yield* runAt(start + hours(2))).toEqual({ queries: 0, delivered: [] });
			const [advanced] = yield* evaluated;
			assert(advanced);
			expect(advanced.evaluatedAt.getTime()).toBe(start + hours(2));
			expect(advanced.snapshot).not.toBe(first.snapshot);
			expect(yield* runAt(start + hours(25))).toEqual({ queries: 0, delivered: [] });
			expect(yield* runAt(start + hours(49))).toEqual({ queries: 0, delivered: [] });
		}),
	);

	test.effect("evaluates again once a write that was running during its evaluation commits", () =>
		Effect.gen(function* () {
			yield* reset;
			const session = yield* DatabaseSession;
			const written = yield* Deferred.make<void>();
			const commit = yield* Deferred.make<void>();
			const writer = yield* session
				.transaction(
					Effect.gen(function* () {
						yield* insertEntity("late", start - hours(1));
						yield* Deferred.succeed(written, undefined);
						yield* Deferred.await(commit);
					}),
				)
				.pipe(Effect.forkChild);
			yield* Deferred.await(written);
			expect(yield* runAt(start)).toEqual({ queries: 1, delivered: [] });
			expect(yield* runAt(start + 60_000)).toEqual({ queries: 0, delivered: [] });
			yield* Deferred.succeed(commit, undefined);
			yield* Fiber.join(writer);
			expect(yield* runAt(start + 120_000)).toEqual({ queries: 1, delivered: ["late"] });
			expect(yield* runAt(start + 180_000)).toEqual({ queries: 0, delivered: ["late"] });
		}),
	);

	test.effect("catches up on an occurrence that fell due while no run happened", () =>
		Effect.gen(function* () {
			yield* reset;
			yield* insertEntity("missed", start + hours(2));
			expect(yield* runAt(start)).toEqual({ queries: 1, delivered: [] });
			expect(yield* runAt(start + hours(47))).toEqual({ queries: 1, delivered: ["missed"] });
		}),
	);

	test.effect("lists a schedule's targets only while the deployment holds its entitlement", () =>
		Effect.gen(function* () {
			yield* reset;
			const repository = yield* SignalScheduleRepository;
			const slugs = (entitlements: ReadonlyArray<"pro">) =>
				repository
					.listTargets({ limit: 50, after: null, entitlements, now: new Date(start) })
					.pipe(Effect.map((targets) => targets.map(({ slug }) => slug)));
			expect(yield* slugs([])).toEqual(["schedule"]);
			expect(yield* slugs(["pro"])).toEqual(["pro-schedule", "schedule"]);
		}),
	);

	test.effect("reaches later targets past more failing targets than one run reads", () =>
		Effect.gen(function* () {
			yield* reset;
			const { pluginId } = yield* Fixture;
			const session = yield* DatabaseSession;
			const failing = Array.from(
				{ length: 500 },
				(_, index) => `${failingUser}${String(index).padStart(3, "0")}`,
			);
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values(failing.map((id) => ({ id, name: id, email: `${id}@example.test` }))),
			);
			yield* session.run((db) =>
				db
					.insert(tables.pluginInstallation)
					.values(failing.map((userId) => ({ userId, pluginId }))),
			);
			yield* session.run((db) =>
				db
					.insert(tables.notificationSubscription)
					.values(
						failing.map((userId) => ({
							userId,
							signalSchemaPluginId: pluginId,
							signalSchemaSlug: "fixture.signal",
						})),
					),
			);
			yield* insertEntity("due", start - hours(1));
			expect(
				yield* runAt(start).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
			).toEqual({ queries: 500, delivered: [] });
			expect(yield* runAt(start + 60_000)).toEqual({ queries: 1, delivered: ["due"] });
			yield* session.run((db) => db.delete(tables.user).where(inArray(tables.user.id, failing)));
		}),
	);
});
