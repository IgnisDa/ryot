import { join } from "node:path";

import { Effect } from "effect";

import type { ScenarioArtifact } from "./artifacts";
import { writeRawJson } from "./artifacts";
import { profileStatus, type RunContext, runFreshRepetition } from "./scenario-runner";
import type { ScenarioDefinition } from "./scenarios";

export const profileRawDirectory = (context: RunContext) =>
	join(context.config.rawDirectory, "profiles");

/**
 * Runs each profile scenario on a fresh process, then copies its raw profiles off the container and
 * host into the mode-0700 raw directory. `profiles/analyze.ts` turns them into committed summaries.
 */
export const runProfileScenarios = (
	context: RunContext,
	scenarios: ReadonlyArray<ScenarioDefinition>,
	persist: (artifact: ScenarioArtifact) => Effect.Effect<unknown, unknown>,
): Effect.Effect<ReadonlyArray<ScenarioArtifact>, unknown> =>
	Effect.gen(function* () {
		const artifacts: ScenarioArtifact[] = [];
		for (const scenario of scenarios) {
			const token = scenario.id;
			const artifact = yield* runFreshRepetition(context, scenario, {
				notes: [],
				round: null,
				repetition: 1,
				orderInRound: null,
				profileToken: token,
			});
			const status = yield* profileStatus(token);
			const attempts = status.executions.flatMap(({ attempts: entries }) => entries);
			yield* context.remote.fetchProfiles(token, profileRawDirectory(context));
			yield* writeRawJson(join(profileRawDirectory(context), token, "meta.json"), {
				workload: scenario.id,
				notes: [
					`${attempts.length} profiled attempts`,
					...attempts.flatMap(({ error }) => (error === null ? [] : [error])),
				],
			});
			const captured = {
				...artifact,
				notes: [
					...artifact.notes,
					`profiled attempts: ${attempts.length}`,
					`heap snapshots: ${attempts.reduce((total, attempt) => total + attempt.heapSnapshotCount, 0)}`,
				],
			} satisfies ScenarioArtifact;
			yield* persist(captured);
			artifacts.push(captured);
			yield* Effect.log("sandbox-resource-baseline.profile", {
				token,
				attempts: attempts.length,
				checkpoints: attempts.reduce((total, attempt) => total + attempt.checkpointCount, 0),
			});
		}
		return artifacts;
	});
