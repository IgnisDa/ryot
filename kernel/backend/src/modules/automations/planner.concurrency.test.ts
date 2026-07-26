import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationExecutionId,
	AutomationTriggerId,
	SignalSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import { Effect, Layer, Redacted } from "effect";
import { assert, describe } from "vitest";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database, DatabaseLive } from "#lib/infrastructure/db/service";
import { PluginEnvironmentConfig } from "#lib/infrastructure/plugin-environment-config";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { kernelDefinitionSource } from "#modules/definition-registry/kernel-source";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { PluginRepository } from "#modules/plugins/repository";

import { triggerFixture } from "./lifecycle.test-support";
import { LifecyclePlannerLive } from "./planner";

describe("LifecyclePlanner independent PostgreSQL transactions", () => {
	it.effect("serializes a shared root budget and replays without spending it twice", () => {
		const config = makeAppConfigLayer({
			automations: { maxRuns: 1 },
			database: { url: Redacted.make(testDatabaseUrl()) },
		});
		const dependencies = Layer.mergeAll(
			PluginRepository.layer,
			PluginEnvironmentConfig.layer,
			Layer.succeed(DefinitionRegistry, makeDefinitionRegistry(kernelDefinitionSource())),
		);
		const services = LifecyclePlannerLive.pipe(
			Layer.provideMerge(dependencies),
			Layer.provideMerge(DatabaseLive),
			Layer.provide(config),
		);
		return Effect.gen(function* () {
			const db = yield* Database;
			const planner = yield* LifecyclePlanner;
			const plugins = yield* PluginRepository;
			const name = `planner_test_${crypto.randomUUID().replaceAll("-", "")}`;
			const directory = new URL("../../drizzle/", import.meta.url).pathname;
			const paths = [...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })];
			assert(paths.length === 1);
			const ddl = yield* Effect.tryPromise({
				try: () => Bun.file(directory + paths[0]).text(),
				catch: () => new DbError({ message: "Cannot read generated baseline" }),
			});
			yield* db.execute(sql`create schema ${sql.identifier(name)}`);
			const transaction = <A, E>(body: Effect.Effect<A, E, Database>) =>
				db.transaction((tx) =>
					Effect.gen(function* () {
						yield* tx.execute(sql`set local search_path to ${sql.identifier(name)}, public`);
						return yield* body;
					}).pipe(Effect.provideService(Database, tx)),
				);
			yield* Effect.gen(function* () {
				yield* transaction(
					Effect.gen(function* () {
						const tx = yield* Database;
						for (const statement of ddl.split("--> statement-breakpoint")) {
							yield* tx.execute(sql.raw(statement));
						}
						yield* tx
							.insert(tables.user)
							.values({ id: "owner", name: "Owner", preferences: {}, email: "owner@example.test" });
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
						const tx = yield* Database;
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
			}).pipe(
				Effect.ensuring(
					db.execute(sql`drop schema ${sql.identifier(name)} cascade`).pipe(Effect.orDie),
				),
			);
		}).pipe(Effect.provide(Layer.mergeAll(services, makeConfigProviderLayer())));
	});
});
