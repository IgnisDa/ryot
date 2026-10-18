import { mediaPlugin } from "@ryot-app/media-plugin";
import { MediaImportPopulationWorkflowOutput } from "@ryot-app/media-plugin/contracts/workflows";
import { Clock, Effect, Schema } from "effect";

import {
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	getMediaPopulationGateResult,
	sampleOperationalPressure,
	shippedPluginTestProviders,
} from "~/fixtures/kernel";
import { findMediaEntitySchema, startMediaPopulationGate } from "~/fixtures/plugins/media";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import { startIsolatedHarness } from "~/support/isolated-harness";

const CONCURRENCY_LEVELS = [5, 20] as const;
const REPETITIONS = 3;
const GATE_TIMEOUT_MS = 600_000;
const POLL_INTERVAL = "100 millis";
const RUN_OPERATIONAL_GATES =
	process.env.RUN_OPERATIONAL_GATES === "1" || process.env.RUN_OPERATIONAL_GATES === "true";

describe.skipIf(!RUN_OPERATIONAL_GATES)("media population overlap gate", () => {
	let harness: undefined | Effect.Success<ReturnType<typeof startIsolatedHarness>>;
	let target: Effect.Success<ReturnType<typeof startIsolatedHarness>>["target"];
	let media: Effect.Success<ReturnType<typeof shippedPluginTestProviders>>;

	beforeAll(() =>
		runPromise(
			Effect.gen(function* () {
				harness = yield* startIsolatedHarness("Media Population Overlap Gate");
				target = harness.target;
				media = yield* shippedPluginTestProviders(mediaPlugin.metadata.packageId, target);
			}),
		),
	);

	afterAll(() => runPromise(harness?.stop ?? Effect.void));

	it.live("completes repeated overlapping five- and twenty-import runs without deadlocks", () =>
		Effect.gen(function* () {
			const user = yield* createAuthenticatedClient(target);
			const { schema } = yield* findMediaEntitySchema(user.client, "music");
			const provider = yield* media.attachProvider({
				rootEntitySchemaSlug: schema.id,
				details: fakeProviderDetailsResult({
					properties: {},
					name: "Overlapping test track",
					relatedEntityGroups: [
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "person-to-music",
							entities: [
								{
									name: "Shared artist alpha",
									externalId: "overlap-artist-alpha",
									providerSlug: "person.youtube-music",
									relationshipProperties: { roles: ["Artist"] },
								},
								{
									name: "Shared artist zeta",
									externalId: "overlap-artist-zeta",
									providerSlug: "person.youtube-music",
									relationshipProperties: { roles: ["Artist"] },
								},
							],
						},
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "music-group-to-music",
							entities: [
								{
									name: "Shared album",
									externalId: "overlap-album",
									providerSlug: "music-group.youtube-music",
									relationshipProperties: { roles: ["Member"] },
								},
							],
						},
					],
				}),
			});
			const baseline = yield* sampleOperationalPressure(
				[`overlap-baseline-${crypto.randomUUID()}`],
				target,
			);

			for (const concurrency of CONCURRENCY_LEVELS) {
				for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
					const prefix = `overlap-${concurrency}-${repetition}-${crypto.randomUUID()}`;
					const runs = yield* Effect.forEach(
						Array.from({ length: concurrency }, (_, index) => index),
						(index) =>
							startMediaPopulationGate(
								{
									itemCount: 1,
									entitySchemaSlug: schema.id,
									executingUserId: user.userId,
									providerId: provider.providerId,
									identifierPrefix: `${prefix}-${index}`,
								},
								target,
							),
						{ concurrency: "unbounded" },
					);
					const deadline = (yield* Clock.currentTimeMillis) + GATE_TIMEOUT_MS;
					let results = yield* Effect.forEach(
						runs,
						(run) => getMediaPopulationGateResult(run, target),
						{ concurrency: "unbounded" },
					);
					while (
						results.some((result) => result.executions.some(({ status }) => status === "pending"))
					) {
						if ((yield* Clock.currentTimeMillis) >= deadline) {
							return yield* Effect.die(
								new Error(`Overlap gate timed out at concurrency ${concurrency}`),
							);
						}
						yield* Effect.sleep(POLL_INTERVAL);
						results = yield* Effect.forEach(
							runs,
							(run) => getMediaPopulationGateResult(run, target),
							{ concurrency: "unbounded" },
						);
					}

					for (const result of results) {
						for (const execution of result.executions) {
							expect(execution.status).toBe("completed");
							const output = yield* Schema.decodeUnknownEffect(MediaImportPopulationWorkflowOutput)(
								execution.output,
							);
							expect(output.results).toHaveLength(1);
							expect(output.results[0]?.status).toBe("completed");
						}
					}
				}
			}

			const finalPressure = yield* sampleOperationalPressure(
				[`overlap-final-${crypto.randomUUID()}`],
				target,
			);
			expect(finalPressure.database.deadlocks - baseline.database.deadlocks).toBe(0);
			expect(finalPressure.database.lockWaitingConnections).toBe(0);
			expect(finalPressure.locks.waitingAdvisoryLocks).toBe(0);
			return undefined;
		}),
	);
});
