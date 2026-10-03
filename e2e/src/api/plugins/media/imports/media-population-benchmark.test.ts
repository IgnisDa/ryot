import { UserId } from "@ryot-app/contract/schema/brands";
import { MediaImportPopulationWorkflowOutput } from "@ryot-app/media-plugin/contracts/workflows";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Clock, Config, Effect, Schema } from "effect";

import {
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	getEntity,
	getMediaPopulationGateResult,
	installTestProvider,
	sampleOperationalPressure,
	signInWithPassword,
} from "~/fixtures/kernel";
import { makeSession } from "~/fixtures/kernel/contract-client";
import { startMediaPopulationGate } from "~/fixtures/plugins/media";
import { assert, describe, expect, it } from "~/support/effect-test";

const itemCount = 1_001;
const timeoutMs = 3_600_000;

describe.skipIf(process.env.SANDBOX_IMPORT_BENCHMARK !== "1")("sandbox import benchmark", () => {
	it.live("standard_provider_import_matches_rows_and_improves_time_and_memory", () =>
		Effect.gen(function* () {
			const backendPid = yield* Config.Int("E2E_SERVER_PID");
			const user = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(user.client, "book");
			const provider = yield* installTestProvider({
				client: user.client,
				rootEntitySchemaSlug: schema.id,
				slug: "sandbox-import-benchmark",
				pluginSlug: "sandbox-import-benchmark",
				name: "Sandbox import benchmark provider",
				details: fakeProviderDetailsResult({
					properties: {},
					name: "Sandbox import benchmark book",
				}),
			});
			const baseline = yield* sampleOperationalPressure(["sandbox-import-benchmark-baseline"]);
			const startedAt = yield* Clock.currentTimeMillis;
			yield* Effect.logInfo(
				`sandbox-import-benchmark-start ${stableStringify({
					itemCount,
					startedAt,
					backendPid,
					workerConcurrency: 2,
					providerSourceHash: provider.sourceHash,
				})}`,
			);
			const run = yield* startMediaPopulationGate({
				itemCount,
				entitySchemaSlug: schema.id,
				executingUserId: user.userId,
				providerId: provider.providerId,
				identifierPrefix: "sandbox-import-benchmark",
			});
			let result = yield* getMediaPopulationGateResult(run);
			let lastProgressAt = startedAt;
			while (result.executions.some(({ status }) => status === "pending")) {
				const now = yield* Clock.currentTimeMillis;
				if (now - startedAt >= timeoutMs) {
					return yield* Effect.die(new Error("Sandbox import benchmark exceeded 60 minutes"));
				}
				if (now - lastProgressAt >= 10_000) {
					const pressure = yield* sampleOperationalPressure(run.executionIds);
					yield* Effect.logInfo(
						`sandbox-import-benchmark-progress ${stableStringify({
							pressure,
							elapsedMs: now - startedAt,
							pending: result.executions.filter(({ status }) => status === "pending").length,
						})}`,
					);
					lastProgressAt = now;
				}
				yield* Effect.sleep("1 second");
				result = yield* getMediaPopulationGateResult(run);
			}
			const finishedAt = yield* Clock.currentTimeMillis;
			yield* Effect.logInfo(`sandbox-import-benchmark-end ${stableStringify({ finishedAt })}`);
			const pressure = yield* sampleOperationalPressure(run.executionIds);
			const results = result.executions.flatMap((execution) => {
				expect(execution.status).toBe("completed");
				return Schema.decodeUnknownSync(MediaImportPopulationWorkflowOutput)(execution.output)
					.results;
			});
			expect(results).toHaveLength(itemCount);
			const authentication = yield* signInWithPassword(user.email, user.password);
			assert(authentication.token !== undefined);
			const snapshotClient = makeSession(
				undefined,
				{ Authorization: `Bearer ${authentication.token}` },
				UserId.make(user.userId),
			);
			const businessRows = yield* Effect.forEach(
				results,
				(population) =>
					Effect.gen(function* () {
						expect(population.status).toBe("completed");
						if (population.status !== "completed") {
							return yield* Effect.die(new Error("Benchmark population did not complete"));
						}
						const entity = yield* getEntity(snapshotClient, population.entityId);
						return {
							name: entity.name,
							properties: entity.properties,
							externalId: entity.externalId,
							entitySchemaSlug: entity.entitySchemaSlug,
							populationStatus: entity.populationStatus,
							translationStatus: entity.translationStatus,
						};
					}),
				{ concurrency: 4 },
			);
			expect(pressure.database.deadlocks - baseline.database.deadlocks).toBe(0);
			expect(pressure.redis.projectionErrors).toBe(0);
			expect(pressure.sandbox.maxActiveExecutions).toBeLessThanOrEqual(2);
			yield* Effect.logInfo(
				`sandbox-import-benchmark-result ${stableStringify({
					pressure,
					itemCount,
					startedAt,
					finishedAt,
					workerConcurrency: 2,
					wallMs: finishedAt - startedAt,
					providerSourceHash: provider.sourceHash,
					businessRows: sortBy(businessRows, (row) => row.externalId ?? ""),
					sandboxExecutions: pressure.sandbox.totalExecutions - baseline.sandbox.totalExecutions,
				})}`,
			);
			return undefined;
		}),
	);
});
