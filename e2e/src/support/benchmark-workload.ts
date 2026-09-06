import type { ContractSuccess } from "@ryot-app/contract/client";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Effect } from "effect";

import {
	adminHeaders,
	enqueueSandboxScript,
	getApiClient,
	sampleSandboxRuntime,
} from "~/fixtures/kernel";

export type RuntimeSample = ContractSuccess<"testSupport", "sampleSandboxRuntime">;
export type SandboxJobResult = ContractSuccess<"testSupport", "getSandboxResult">;
export type SandboxProcessMode = "on-demand" | "warm";

export const percentile = (values: ReadonlyArray<number>, ratio: number) => {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
};

export const average = (values: ReadonlyArray<number>) =>
	values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

export const summarizeRuntimeSamples = (samples: ReadonlyArray<RuntimeSample>) => ({
	sampleCount: samples.length,
	totalSpawned: samples.at(-1)?.totalSpawned ?? 0,
	processCount: {
		p50: percentile(
			samples.map(({ workers }) => workers.length),
			0.5,
		),
		p95: percentile(
			samples.map(({ workers }) => workers.length),
			0.95,
		),
	},
	workerRssBytes: {
		p50: percentile(
			samples.map(({ workerRssBytes }) => workerRssBytes),
			0.5,
		),
		p95: percentile(
			samples.map(({ workerRssBytes }) => workerRssBytes),
			0.95,
		),
	},
	backendRssBytes: {
		p50: percentile(
			samples.map(({ backendRssBytes }) => backendRssBytes),
			0.5,
		),
		p95: percentile(
			samples.map(({ backendRssBytes }) => backendRssBytes),
			0.95,
		),
	},
});

export const pollSandboxJobResult = (executingUserId: string, jobId: string, intervalMs = 200) =>
	Effect.gen(function* () {
		for (;;) {
			const result = yield* getApiClient().call(
				(client) =>
					client.testSupport.getSandboxResult({
						params: { jobId },
						query: { executingUserId: UserId.make(executingUserId) },
					}),
				adminHeaders(),
			);
			if (result.status !== "pending") {
				return result;
			}
			yield* Effect.sleep(`${intervalMs} millis`);
		}
	});

/**
 * On-demand workers exit after their execution, so idleness is the absence of workers; the warm
 * pool instead keeps processes alive, so its idle state is the presence of at least one.
 */
export const waitForSandboxIdle = (
	processMode: SandboxProcessMode,
	options: { attempts?: number; intervalMs?: number } = {},
) =>
	Effect.gen(function* () {
		const attempts = options.attempts ?? 200;
		const intervalMs = options.intervalMs ?? 100;
		for (let attempt = 0; attempt < attempts; attempt += 1) {
			const metrics = yield* sampleSandboxRuntime;
			const settled =
				processMode === "warm"
					? metrics.activeProcessCount > 0
					: metrics.activeProcessCount === 0 && metrics.workers.length === 0;
			if (settled) {
				return true;
			}
			yield* Effect.sleep(`${intervalMs} millis`);
		}
		return false;
	});

export type DirectSandboxSample = {
	latencyMs: number;
	before: RuntimeSample;
	after: RuntimeSample;
	executionId: string;
	result: SandboxJobResult;
};

export const runDirectSandboxSample = (input: {
	userId: string;
	context: unknown;
	pollIntervalMs?: number;
	scriptId: Parameters<typeof enqueueSandboxScript>[1]["scriptId"];
}) =>
	Effect.gen(function* () {
		const before = yield* sampleSandboxRuntime;
		const startedAt = yield* Clock.currentTimeMillis;
		const { jobId, executionId } = yield* enqueueSandboxScript(input.userId, {
			context: input.context,
			scriptId: input.scriptId,
		});
		const result = yield* pollSandboxJobResult(input.userId, jobId, input.pollIntervalMs ?? 10);
		const latencyMs = (yield* Clock.currentTimeMillis) - startedAt;
		const after = yield* sampleSandboxRuntime;
		return { after, before, result, latencyMs, executionId } satisfies DirectSandboxSample;
	});
