import { expect, it } from "@effect/vitest";
import {
	AutomationExecutionId,
	AutomationTriggerId,
	SignalSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import { eq, sql } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer, Redacted, type Tracer } from "effect";
import { assert, describe } from "vitest";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { setLocalStatementTimeout, DatabaseSession } from "#lib/infrastructure/db/session";
import {
	applyBaselineMigration,
	baselineMigrationStatements,
} from "#lib/test-utils/baseline-migration";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { makeRecordingTracer } from "#lib/test-utils/tracer";
import { kernelDefinitionSource } from "#modules/definition-registry/kernel-source";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import { PluginRepository } from "#modules/plugins/repository";
import { fixtureManifest } from "#modules/plugins/test-support";

import { triggerFixture } from "./lifecycle.test-support";
import { LifecyclePlannerLive } from "./planner";

const pluginId = "fixture-plugin";

const bootstrap = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	const db = yield* session.current;
	const planner = yield* LifecyclePlanner;
	const plugins = yield* PluginRepository;
	const name = `planner_test_${crypto.randomUUID().replaceAll("-", "")}`;
	const statements = yield* baselineMigrationStatements();
	yield* db.execute(sql`create schema ${sql.identifier(name)}`);
	const transaction = <A, E, R>(body: Effect.Effect<A, E, R>) =>
		session.transaction(
			Effect.gen(function* () {
				const tx = yield* session.current;
				yield* tx.execute(sql`set local search_path to ${sql.identifier(name)}, public`);
				return yield* body;
			}),
		);
	return { db, name, planner, plugins, statements, transaction };
});

type PlannerHarness = Effect.Success<typeof bootstrap>;

const withPlannerSchema = <A, E, R>(body: (harness: PlannerHarness) => Effect.Effect<A, E, R>) => {
	const config = makeAppConfigLayer({
		automations: { maxRuns: 1 },
		database: { url: Redacted.make(testDatabaseUrl()) },
	});
	const dependencies = Layer.mergeAll(
		PluginRepository.layer,
		PluginConfigRevisions.layer,
		DefinitionRepository.layer,
	);
	const services = LifecyclePlannerLive.pipe(
		Layer.provideMerge(dependencies),
		Layer.provideMerge(DatabaseSession.layer),
		Layer.provide(config),
	);
	return Effect.gen(function* () {
		const harness = yield* bootstrap;
		return yield* body(harness).pipe(
			Effect.ensuring(
				harness.db
					.execute(sql`drop schema ${sql.identifier(harness.name)} cascade`)
					.pipe(Effect.orDie),
			),
		);
	}).pipe(Effect.provide(Layer.mergeAll(services, makeConfigProviderLayer())));
};

// `plugin_active_revision_check` and the circular revision/plugin foreign key force the order:
// an inactive plugin, then its revision, then the activation, then the installation. The manifest
// declares no scripts, because a revision read demands a compiled row for each one, and the
// installation keeps a null config pointer, so `catalog` drops the row and plans stay zero-run
// while `lockCatalog` still takes one real `plugin-config:` key.
const seedCatalog = (statements: readonly string[]) =>
	Effect.gen(function* () {
		const tx = yield* (yield* DatabaseSession).current;
		yield* applyBaselineMigration(statements, (statement) => tx.execute(sql.raw(statement)));
		yield* tx
			.insert(tables.user)
			.values({ id: "owner", name: "Owner", preferences: {}, email: "owner@example.test" });
		yield* tx
			.insert(tables.plugin)
			.values({ id: pluginId, slug: "fixture", scope: "system", status: "inactive" });
		yield* tx
			.insert(tables.pluginRevision)
			.values({
				pluginId,
				version: "1.0.0",
				id: "fixture-revision",
				sourceHash: "fixture-source",
				clientConfigSchema: { fields: {} },
				manifest: { ...fixtureManifest(), hooks: [], scripts: [], signalSchemas: [] },
			});
		yield* tx
			.update(tables.plugin)
			.set({ status: "active", activeRevisionId: "fixture-revision" })
			.where(eq(tables.plugin.id, pluginId));
		yield* tx
			.insert(tables.pluginInstallation)
			.values({
				pluginId,
				userId: "owner",
				health: "ready",
				isDisabled: false,
				id: "fixture-installation",
				activeConfigRevisionId: null,
			});
	});

const withRoot = (id: string, rootExecutionId: string) => {
	const trigger = triggerFixture(id);
	return {
		...trigger,
		causation: {
			...trigger.causation,
			rootExecutionId: AutomationExecutionId.make(rootExecutionId),
		},
	};
};

const statements = (spans: ReadonlyArray<Tracer.Span>, fragment: string) =>
	spans.filter((span) => {
		const text = span.attributes.get("db.query.text");
		return typeof text === "string" && text.includes(fragment);
	}).length;

const counted = (spans: ReadonlyArray<Tracer.Span>) => ({
	exclusive: statements(spans, "pg_advisory_xact_lock("),
	shared: statements(spans, "pg_advisory_xact_lock_shared("),
	catalog: statements(spans, 'from "plugin"') + statements(spans, 'from "user_plugin"'),
});

describe("LifecyclePlanner independent PostgreSQL transactions", () => {
	it.effect("serializes a shared root budget and replays without spending it twice", () =>
		withPlannerSchema(({ planner, plugins, statements, transaction }) =>
			Effect.gen(function* () {
				yield* transaction(
					Effect.gen(function* () {
						const tx = yield* (yield* DatabaseSession).current;
						yield* applyBaselineMigration(statements, (statement) =>
							tx.execute(sql.raw(statement)),
						);
						yield* tx
							.insert(tables.user)
							.values({ id: "owner", name: "Owner", preferences: {}, email: "owner@example.test" });
						yield* (yield* DefinitionRepository.make).replaceKernelDefinitions(
							kernelDefinitionSource(),
						);
						yield* tx
							.insert(tables.notificationSubscription)
							.values({ userId: "owner", signalSchemaSlug: "integration.disabled" });
						yield* plugins.persistKernelScript({
							name: "Notify",
							source: "code",
							compiledFormat: 1,
							compiledCode: "code",
							contentHash: "kernel-current",
							slug: "automation.notification",
							metadata: {
								name: "Notify",
								capabilities: [],
								kind: "automation",
								automationType: "automation",
								requiredPluginConfigKeys: [],
								requiredSystemConfigKeys: [],
								slug: "automation.notification",
								inputProjection: {
									entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
								},
							},
						});
					}),
				);
				const inputs = ["left", "right"].map((id) => {
					const trigger = triggerFixture(id);
					assert(trigger.payload?.resource === "signal");
					return {
						trigger: {
							...trigger,
							causation: { ...trigger.causation, depth: 1 },
							payload: {
								...trigger.payload,
								signalSchemaSlug: SignalSchemaSlug.make("integration.disabled"),
							},
						},
					};
				});
				const results = yield* Effect.forEach(inputs, (input) => transaction(planner.plan(input)), {
					concurrency: 2,
				});
				expect(results.map(({ runs }) => runs.length).sort((a, b) => a - b)).toEqual([0, 1]);
				expect(results.find(({ runs }) => runs.length === 0)).toMatchObject({
					policies: [],
					trigger: { blockedReason: { hasRequiredHooks: false } },
				});
				const replayed = yield* Effect.forEach(
					inputs,
					(input) => transaction(planner.plan(input)),
					{ concurrency: 2 },
				);
				expect(replayed).toEqual(
					results.map((result) => Object.assign(result, { wasCreated: false })),
				);
				yield* transaction(
					Effect.gen(function* () {
						const tx = yield* (yield* DatabaseSession).current;
						expect(yield* tx.select().from(tables.automationRun)).toHaveLength(1);
						const triggers = yield* tx.select().from(tables.automationTrigger);
						expect(triggers).toHaveLength(2);
						expect(
							triggers
								.filter(({ blockedReason }) => blockedReason !== null)
								.map(({ blockedReason }) => blockedReason),
						).toEqual([
							{
								hasRequiredHooks: false,
								code: "automation-limit-reached",
								omittedHooks: [{ pluginId: null, hookSlug: "automation.notification" }],
							},
						]);
					}),
				);
				const original = inputs[0];
				assert(original);
				const duplicate = {
					trigger: {
						...original.trigger,
						id: AutomationTriggerId.make("concurrent-identical"),
						causation: {
							...original.trigger.causation,
							rootExecutionId: AutomationExecutionId.make("another-root"),
						},
					},
				};
				const identical = yield* Effect.forEach(
					[duplicate, duplicate],
					(input) => transaction(planner.plan(input)),
					{ concurrency: 2 },
				);
				expect(
					identical
						.map(({ wasCreated }) => wasCreated)
						.sort((left, right) => Number(left) - Number(right)),
				).toEqual([false, true]);
				expect(identical[0]?.runs).toEqual(identical[1]?.runs);
			}),
		),
	);

	it.effect("plans while another planner holds the catalog lock open", () =>
		withPlannerSchema(({ planner, statements, transaction }) =>
			Effect.gen(function* () {
				yield* transaction(seedCatalog(statements));
				const holding = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const holder = yield* Effect.forkChild(
					transaction(
						planner
							.plan({ trigger: withRoot("holder", "holder-root") })
							.pipe(
								Effect.andThen(Deferred.succeed(holding, undefined)),
								Effect.andThen(Deferred.await(release)),
							),
					),
				);
				yield* Deferred.await(holding);
				const planned = yield* transaction(
					setLocalStatementTimeout(2_000).pipe(
						Effect.andThen(planner.plan({ trigger: withRoot("reader", "reader-root") })),
					),
				).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
				expect(planned).toMatchObject({ runs: [], policies: [], wasCreated: true });
				yield* Fiber.join(holder);
			}),
		),
	);

	it.effect("cannot plan while a configuration writer holds the catalog lock", () =>
		withPlannerSchema(({ planner, statements, transaction }) =>
			Effect.gen(function* () {
				yield* transaction(seedCatalog(statements));
				const holding = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const configs = yield* PluginConfigRevisions;
				const holder = yield* Effect.forkChild(
					transaction(
						configs
							.lock(pluginId)
							.pipe(
								Effect.andThen(Deferred.succeed(holding, undefined)),
								Effect.andThen(Deferred.await(release)),
							),
					),
				);
				yield* Deferred.await(holding);
				const failure = yield* transaction(
					setLocalStatementTimeout(250).pipe(
						Effect.andThen(planner.plan({ trigger: withRoot("blocked", "blocked-root") })),
					),
				).pipe(Effect.flip, Effect.ensuring(Deferred.succeed(release, undefined)));
				expect(failure).toMatchObject({
					_tag: "DbError",
					message: expect.stringContaining("canceling statement due to statement timeout"),
				});
				yield* Fiber.join(holder);
			}),
		),
	);

	it.effect("locks the catalog and reads it once however many triggers a transaction plans", () =>
		withPlannerSchema(({ planner, statements, transaction }) =>
			Effect.gen(function* () {
				yield* transaction(seedCatalog(statements));
				const many: Tracer.Span[] = [];
				yield* transaction(
					Effect.forEach(["first", "second", "third"], (id) =>
						planner.plan({ trigger: withRoot(id, `${id}-root`) }),
					),
				).pipe(Effect.withTracer(makeRecordingTracer(many)));
				const single: Tracer.Span[] = [];
				yield* transaction(planner.plan({ trigger: withRoot("single", "single-root") })).pipe(
					Effect.withTracer(makeRecordingTracer(single)),
				);
				// The ingestion key plus the one `plugin-config:` key, the two `lockCatalog` selects plus
				// the one `catalog` select, and the per-trigger `automation-root:` lock as the control.
				expect(counted(many)).toEqual({ shared: 2, catalog: 3, exclusive: 3 });
				expect(counted(single)).toEqual({ shared: 2, catalog: 3, exclusive: 1 });
			}),
		),
	);
});
