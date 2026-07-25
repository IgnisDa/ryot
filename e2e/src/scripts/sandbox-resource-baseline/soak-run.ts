import type { ContractSuccess } from "@ryot-app/contract/client";
import { Clock, Effect } from "effect";

import { adminHeaders, getApiClient } from "~/fixtures/kernel";

import type { MetricValues, ScenarioArtifact, WaveSummary } from "./artifacts";
import { REMOTE_FILES } from "./ops";
import type { ImportRecord } from "./phases";
import { retentionSlopes } from "./retention";
import {
	captureRepetition,
	type CaptureSources,
	emptySources,
	listPhaseSegments,
	mergeSources,
	prepareFreshProcess,
	readSources,
	retryTransport,
	type RunContext,
	submitWave,
} from "./scenario-runner";
import type { ScenarioDefinition } from "./scenarios";

type BackendAction = "checkpoint" | "gc" | "heap-snapshot" | "cpu-start" | "cpu-stop";
type BackendCheckpoint = ContractSuccess<"testSupport", "captureBackendProfile">;

const backendProfile = (token: string, label: string, action: BackendAction) => {
	const capture = getApiClient().call(
		(client) => client.testSupport.captureBackendProfile({ payload: { token, label, action } }),
		adminHeaders(),
	);
	return action === "cpu-start" || action === "cpu-stop" ? capture : retryTransport(capture);
};

const checkpointValues = (checkpoint: BackendCheckpoint): MetricValues => {
	return {
		"post.bunRssBytes": checkpoint.processMemory.rss,
		"post.activeWorkflows": checkpoint.activeWorkflows,
		"post.jscHeapSizeBytes": checkpoint.jscHeap.heapSize,
		"post.jscObjectCount": checkpoint.jscHeap.objectCount,
		"post.bunHeapUsedBytes": checkpoint.processMemory.heapUsed,
		"post.bunExternalBytes": checkpoint.processMemory.external,
		"post.bunHeapTotalBytes": checkpoint.processMemory.heapTotal,
		"post.cgroupMemoryBytes": checkpoint.cgroupMemoryCurrentBytes,
	};
};

/**
 * Keeps one Bun process alive across every wave. A heap snapshot allocates hundreds of megabytes
 * and leaves the allocator high-water raised, so snapshots are taken from a separate fresh process
 * before the soak and only after the final recovery; the waves themselves use a cheap heap census.
 */
export const runSoak = (
	context: RunContext,
	scenario: ScenarioDefinition,
	profileToken: string,
): Effect.Effect<ScenarioArtifact, unknown> =>
	Effect.gen(function* () {
		const { remote } = context;
		yield* prepareFreshProcess(context, scenario);
		yield* Effect.sleep(`${scenario.idleDurationMs} millis`);
		yield* backendProfile(profileToken, "fresh-idle-reference", "checkpoint");
		yield* backendProfile(profileToken, "fresh-idle-reference", "heap-snapshot");

		const prepared = yield* prepareFreshProcess(context, scenario);
		const [appOffset, hostOffset] = yield* Effect.all([
			remote.fileSize(REMOTE_FILES.appSamples),
			remote.fileSize(REMOTE_FILES.hostSamples),
		]);
		const phaseSequence = yield* listPhaseSegments(0).pipe(
			Effect.map((segments) => segments.at(-1)?.sequence ?? 0),
		);
		const containersBefore = yield* remote.metadata.pipe(
			Effect.map(({ containers }) => containers as ReadonlyArray<Record<string, unknown>>),
		);
		const peakReset = yield* remote.resetPeak;
		const startedAtMs = yield* Clock.currentTimeMillis;
		yield* Effect.sleep(`${scenario.idleDurationMs} millis`);
		const freshIdle = yield* backendProfile(profileToken, "fresh-idle", "checkpoint");

		let sources: CaptureSources = emptySources;
		let offsets = { appOffset, hostOffset };
		const waves: WaveSummary[] = [];
		const retentionPoints = [{ operations: 0, values: checkpointValues(freshIdle) }];
		const allRequests: Array<ScenarioArtifact["requests"][number]> = [];
		const importRecords: ImportRecord[] = [];
		let submittedAtMs = 0;
		let terminalAtMs = 0;
		/**
		 * Profiling a concurrent wave costs about 1.9 GB on top of the load itself, which drove host
		 * available memory under the watchdog floor and had the ryot container stopped mid-soak. The
		 * profile phase already covers concurrent execution, so only sequential waves are profiled.
		 */
		const profiledWave = scenario.sequential;

		for (let wave = 1; wave <= scenario.waves; wave += 1) {
			if (wave === 2 && profiledWave) {
				yield* backendProfile(profileToken, `wave-${wave}`, "cpu-start");
			}
			const waveSubmittedAtMs = yield* Clock.currentTimeMillis;
			submittedAtMs = submittedAtMs === 0 ? waveSubmittedAtMs : submittedAtMs;
			const submission = yield* submitWave(context, scenario, {
				wave,
				workload: scenario.workload,
				liveExternalIds: context.state.liveExternalIds,
				nonce: `${context.runId}-${scenario.id}-w${wave}`,
			});
			terminalAtMs = yield* Clock.currentTimeMillis;
			if (wave === 2 && profiledWave) {
				yield* backendProfile(profileToken, `wave-${wave}`, "cpu-stop");
			}
			allRequests.push(
				...submission.requests.map(({ executionKey: _executionKey, ...request }) => request),
			);
			importRecords.push(...submission.importRecords);
			const checkpoints: Array<WaveSummary["checkpoints"][number]> = [];
			let elapsedMs = 0;
			for (const afterMs of scenario.recoveryCheckpointsMs) {
				yield* Effect.sleep(`${afterMs - elapsedMs} millis`);
				elapsedMs = afterMs;
				const label = `wave-${wave}-${Math.round(afterMs / 60_000)}m`;
				const checkpoint = yield* backendProfile(profileToken, label, "checkpoint");
				checkpoints.push({ label, afterMs, values: checkpointValues(checkpoint) });
			}
			const waveSources = yield* readSources(remote, offsets);
			sources = mergeSources(sources, waveSources);
			offsets = {
				appOffset: yield* remote.fileSize(REMOTE_FILES.appSamples),
				hostOffset: yield* remote.fileSize(REMOTE_FILES.hostSamples),
			};
			const drained = waveSources.records.find(
				({ t, workers, activeExecutions }) =>
					t >= terminalAtMs && workers.length === 0 && activeExecutions === 0,
			);
			waves.push({
				wave,
				checkpoints,
				terminalAtMs,
				submittedAtMs: waveSubmittedAtMs,
				requests: submission.requests.length,
				drainedAfterMs: drained === undefined ? null : drained.t - terminalAtMs,
				failed: submission.requests.filter(({ outcome }) => outcome !== "completed").length,
			});
			retentionPoints.push({
				operations: wave * scenario.requestCount,
				values: checkpoints.at(-1)?.values ?? {},
			});
			yield* Effect.log("sandbox-resource-baseline.soak.wave", {
				wave,
				scenarioId: scenario.id,
				failed: waves.at(-1)?.failed,
				rss: retentionPoints.at(-1)?.values["post.bunRssBytes"],
			});
			if ((waves.at(-1)?.failed ?? 0) > scenario.requestCount / 2) {
				yield* Effect.log("sandbox-resource-baseline.soak.stopped", {
					wave,
					reason: "wave-failures",
				});
				break;
			}
		}

		const finalRecovery = yield* backendProfile(profileToken, "final-recovery", "checkpoint");
		yield* backendProfile(profileToken, "final-recovery", "heap-snapshot");
		yield* backendProfile(profileToken, "post-gc", "gc");
		const postGc = yield* backendProfile(profileToken, "post-gc", "checkpoint");
		yield* backendProfile(profileToken, "post-gc", "heap-snapshot");
		const completedAtMs = yield* Clock.currentTimeMillis;
		const tail = yield* readSources(remote, offsets);
		const merged = mergeSources(sources, tail);
		const artifact = yield* captureRepetition(context, scenario, {
			waves,
			appOffset,
			hostOffset,
			startedAtMs,
			round: null,
			terminalAtMs,
			submittedAtMs,
			completedAtMs,
			phaseSequence,
			repetition: 1,
			importRecords,
			sources: merged,
			containersBefore,
			orderInRound: null,
			preSample: prepared.sample,
			profileIds: [profileToken],
			requests: allRequests.map((request) => Object.assign({ executionKey: null }, request)),
			notes: [
				"heap snapshots are taken from a separate fresh process and after the final recovery",
			],
			peakReset:
				peakReset === null
					? null
					: { verified: peakReset.verified, supported: peakReset.supported },
		});
		return {
			...artifact,
			metrics: {
				...artifact.metrics,
				...retentionSlopes(retentionPoints),
				...Object.fromEntries(
					Object.entries(checkpointValues(freshIdle)).map(([name, value]) => [
						name.replace("post.", "freshIdle."),
						value,
					]),
				),
				...Object.fromEntries(
					Object.entries(checkpointValues(finalRecovery)).map(([name, value]) => [
						name.replace("post.", "finalRecovery."),
						value,
					]),
				),
				...Object.fromEntries(
					Object.entries(checkpointValues(postGc)).map(([name, value]) => [
						name.replace("post.", "postGc."),
						value,
					]),
				),
				"soak.waves": waves.length,
				"soak.operations": waves.reduce((total, wave) => total + wave.requests, 0),
			},
		} satisfies ScenarioArtifact;
	});
