import { expect, it } from "@effect/vitest";
import { ClientPluginCompilerFailure } from "@ryot-app/client-plugin-compiler";
import type { PluginClientArtifact } from "@ryot-app/client-plugin-contract";
import { ClientRendererId, UserId } from "@ryot-app/contract/schema/brands";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";
import { PluginRepository } from "#modules/plugins/repository";

import type { ResolvedClientPageGraph } from "./graph";
import { ClientPagesRepository } from "./repository";
import { makeClientPageGraphCompiler } from "./service";
import {
	resolveTracerGraphsForCacheTest,
	testClientPageArtifact,
} from "./service-cache.test-support";

type BuildRow = {
	readonly id: string;
	readonly graphHash: string;
	readonly artifactHash: string;
	readonly graphIdentity: unknown;
};

const userId = UserId.make("user-1");
const rendererId = ClientRendererId.make("renderer-1");
const publishedHash = "shared-tracer-source";

const makeRepositoryHarness = () => {
	const finds: string[] = [];
	const builds = new Map<string, BuildRow>();
	const artifacts = new Map<string, PluginClientArtifact>();
	const dialect = new PgDialect();
	let database: Database["Service"];
	const implementation = Object.assign(Object.create(null), {
		transaction: (run: (transaction: Database["Service"]) => Effect.Effect<unknown, unknown>) =>
			run(database),
		select: () => ({
			from: () => ({
				innerJoin: () => ({
					where: (condition: SQL) => ({
						limit: () =>
							Effect.sync(() => {
								const graphHash = String(dialect.sqlToQuery(condition).params.at(-1));
								finds.push(graphHash);
								const build = builds.get(graphHash);
								const storedArtifact = build && artifacts.get(build.artifactHash);
								return build && storedArtifact
									? [
											{
												...build,
												format: storedArtifact.format,
												apiVersion: storedArtifact.apiVersion,
												bridgeVersion: storedArtifact.bridgeVersion,
												compilerVersion: storedArtifact.compilerVersion,
											},
										]
									: [];
							}),
					}),
				}),
			}),
		}),
		insert: (table: object) => ({
			values: (values: Record<string, unknown>) => {
				if (table === schema.pluginClientArtifact) {
					return {
						onConflictDoNothing: () => ({
							returning: () =>
								Effect.sync(() => {
									const hash = String(values["hash"]);
									if (artifacts.has(hash)) {
										return [];
									}
									artifacts.set(hash, testClientPageArtifact(hash));
									return [{ hash }];
								}),
						}),
					};
				}
				if (table === schema.clientPageBuild) {
					return {
						onConflictDoUpdate: () => ({
							returning: () =>
								Effect.sync(() => {
									const graphHash = String(values["graphHash"]);
									const row: BuildRow = {
										graphHash,
										id: `build-${builds.size + 1}`,
										graphIdentity: values["graphIdentity"],
										artifactHash: String(values["artifactHash"]),
									};
									builds.set(graphHash, row);
									return [{ id: row.id }];
								}),
						}),
					};
				}
				return Effect.die("Unexpected artifact file insert");
			},
		}),
	});
	database = Database.of(implementation);
	const databaseLayer = Layer.succeed(Database, database);
	const layer = Layer.mergeAll(
		databaseLayer,
		ClientPagesRepository.layer.pipe(Layer.provide(databaseLayer)),
		PluginRepository.layer.pipe(Layer.provide(databaseLayer)),
	);
	return { layer, finds, builds, artifacts };
};

const prepare = (
	graph: ResolvedClientPageGraph,
	compile: ReturnType<typeof makeClientPageGraphCompiler>,
) =>
	Effect.gen(function* () {
		const repository = yield* ClientPagesRepository;
		const plugins = yield* PluginRepository;
		const existing = yield* repository.findBuild({
			userId,
			rendererId,
			publishedHash,
			graphHash: graph.graphHash,
		});
		if (existing) {
			return existing.artifactHash;
		}
		const compiled = yield* compile(graph);
		const database = yield* Database;
		const buildId = yield* database.transaction((transaction) =>
			Effect.gen(function* () {
				yield* plugins.persistClientArtifact(compiled);
				return yield* repository.createBuild({
					userId,
					rendererId,
					publishedHash,
					graphHash: graph.graphHash,
					artifactHash: compiled.hash,
					graphIdentity: graph.identity,
				});
			}).pipe(Effect.provideService(Database, transaction)),
		);
		if (!buildId) {
			return yield* Effect.die("Build was not stored");
		}
		return compiled.hash;
	});

it.effect("isolates persisted StyleX and Tailwind builds across repository reconstruction", () =>
	Effect.gen(function* () {
		const graphs = yield* resolveTracerGraphsForCacheTest;
		const harness = makeRepositoryHarness();
		const firstCompiles: string[] = [];
		const firstCompiler = makeClientPageGraphCompiler((input) =>
			Effect.sync(() => {
				const engine = input.stylexTracer ? "stylex" : "tailwind";
				firstCompiles.push(engine);
				return testClientPageArtifact(`${engine}-artifact`);
			}),
		);
		expect(yield* prepare(graphs.tailwind, firstCompiler).pipe(Effect.provide(harness.layer))).toBe(
			"tailwind-artifact",
		);

		const restartedCompiles: string[] = [];
		const restartedCompiler = makeClientPageGraphCompiler((input) =>
			Effect.sync(() => {
				const engine = input.stylexTracer ? "stylex" : "tailwind";
				restartedCompiles.push(engine);
				return testClientPageArtifact(`${engine}-artifact`);
			}),
		);
		expect(
			yield* prepare(graphs.stylex, restartedCompiler).pipe(
				Effect.provide(Layer.fresh(harness.layer)),
			),
		).toBe("stylex-artifact");
		expect(
			yield* prepare(graphs.tailwind, restartedCompiler).pipe(
				Effect.provide(Layer.fresh(harness.layer)),
			),
		).toBe("tailwind-artifact");

		expect(firstCompiles).toEqual(["tailwind"]);
		expect(restartedCompiles).toEqual(["stylex"]);
		expect(harness.finds).toEqual([
			graphs.tailwind.graphHash,
			graphs.stylex.graphHash,
			graphs.tailwind.graphHash,
		]);
		expect(harness.builds.size).toBe(2);
		expect(harness.artifacts.size).toBe(2);
		expect(harness.builds.get(graphs.tailwind.graphHash)?.artifactHash).toBe("tailwind-artifact");
		expect(harness.builds.get(graphs.stylex.graphHash)?.artifactHash).toBe("stylex-artifact");
	}),
);

it.effect("writes no tracer artifact or build after failure and persists a later success", () =>
	Effect.gen(function* () {
		const { stylex } = yield* resolveTracerGraphsForCacheTest;
		const harness = makeRepositoryHarness();
		const failedCompiler = makeClientPageGraphCompiler(() =>
			Effect.fail(new ClientPluginCompilerFailure({ diagnostics: [], message: "StyleX failed" })),
		);
		const failure = yield* Effect.flip(
			prepare(stylex, failedCompiler).pipe(Effect.provide(harness.layer)),
		);
		expect(failure.message).toBe("StyleX failed");
		expect(harness.builds.size).toBe(0);
		expect(harness.artifacts.size).toBe(0);

		const laterCompiler = makeClientPageGraphCompiler((input) =>
			input.stylexTracer
				? Effect.succeed(testClientPageArtifact("fresh-stylex-artifact"))
				: Effect.die("Unexpected Tailwind fallback"),
		);
		expect(
			yield* prepare(stylex, laterCompiler).pipe(Effect.provide(Layer.fresh(harness.layer))),
		).toBe("fresh-stylex-artifact");
		expect(harness.finds).toEqual([stylex.graphHash, stylex.graphHash]);
		expect(harness.builds.get(stylex.graphHash)?.artifactHash).toBe("fresh-stylex-artifact");
		expect(harness.artifacts.has("fresh-stylex-artifact")).toBe(true);
	}),
);
