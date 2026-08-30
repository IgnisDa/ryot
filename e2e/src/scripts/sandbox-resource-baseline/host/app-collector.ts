import { openSync, readFileSync, writeFileSync } from "node:fs";

import { appendLine, errorMessage, resolveContainers, type Resolution, wallClockMs } from "./io";
import type { ContainerRole } from "./samples";
import { createStopSignal, runFixedRate } from "./schedule";

export type AppCollectorOptions = {
	readonly project: string;
	readonly output: string;
	readonly tokenFile: string;
	readonly intervalMs: number;
	readonly auxIntervalMs: number;
	readonly port: number;
	readonly pidFile: string | null;
	readonly services: Readonly<Record<ContainerRole, string>>;
};

const REQUEST_TIMEOUT_MS = 5_000;
const RESOLUTION_RETRY_MS = 2_000;
const SMAPS_EVERY_SLOTS = 5;

const timedFetch = async (url: string, init: RequestInit) => {
	const started = performance.now();
	try {
		const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
		const body = await response.text();
		return { body, error: null, status: response.status, latencyMs: performance.now() - started };
	} catch (error) {
		return {
			body: null,
			status: null,
			error: errorMessage(error),
			latencyMs: performance.now() - started,
		};
	}
};

/**
 * Polls the admin-gated runtime snapshot from the benchmark host itself, because the public route
 * adds more than the 200 ms sampling interval in network latency. A second loop records server-side
 * health latency and database pressure once per interval.
 */
export const runAppCollector = async (options: AppCollectorOptions) => {
	const token = readFileSync(options.tokenFile, "utf8").trim();
	const outputFd = openSync(options.output, "a", 0o600);
	if (options.pidFile !== null) {
		writeFileSync(options.pidFile, `${process.pid}\n`);
	}
	const headers = { "Admin-Access-Token": token, "Content-Type": "application/json" };
	let resolution: Resolution = await resolveContainers(options.project, options.services);
	let resolving = false;
	let lastResolutionMs = performance.now();
	let cursor = 0;
	let slots = 0;

	const baseUrl = () => {
		const address = resolution.containers.find(({ role }) => role === "ryot")?.ipAddress;
		return address ? `http://${address}:${options.port}/api` : null;
	};

	const requestResolution = () => {
		if (resolving || performance.now() - lastResolutionMs < RESOLUTION_RETRY_MS) {
			return;
		}
		resolving = true;
		lastResolutionMs = performance.now();
		void resolveContainers(options.project, options.services)
			.then((next) => {
				resolution = next;
				return next;
			})
			.finally(() => {
				resolving = false;
			});
	};

	const signal = createStopSignal();
	process.on("SIGTERM", signal.stop);
	process.on("SIGINT", signal.stop);

	const runtimeLoop = runFixedRate(options.intervalMs, signal, async (slot) => {
		const url = baseUrl();
		const smaps = slots % SMAPS_EVERY_SLOTS === 0 ? "&includeSmaps=true" : "";
		slots += 1;
		const result =
			url === null
				? { body: null, status: null, latencyMs: 0, error: "ryot container unresolved" }
				: await timedFetch(
						`${url}/test-support/sandbox/runtime?completedAfterSequence=${cursor}${smaps}`,
						{ headers },
					);
		let sample: unknown = null;
		if (result.status === 200) {
			sample = JSON.parse(result.body);
			const sequence =
				typeof sample === "object" && sample !== null && "completedWorkerSequence" in sample
					? sample.completedWorkerSequence
					: null;
			if (typeof sequence === "number") {
				cursor = sequence;
			}
		} else {
			requestResolution();
		}
		appendLine(outputFd, {
			sample,
			kind: "app-sample",
			status: result.status,
			startedMs: slot.startedMs,
			timestampMs: slot.startedMs,
			scheduledMs: slot.scheduledMs,
			missedSlotsBefore: slot.missedSlotsBefore,
			durationMs: performance.now() - slot.startedMonotonicMs,
			error: result.status === 200 ? null : (result.error ?? `status ${result.status}`),
		});
	});

	const auxLoop = runFixedRate(options.auxIntervalMs, signal, async (slot) => {
		const url = baseUrl();
		const health =
			url === null ? null : await timedFetch(`${url}/system/health`, { method: "GET" });
		const pressure =
			url === null
				? null
				: await timedFetch(`${url}/test-support/operational-gate/pressure`, {
						headers,
						method: "POST",
						body: JSON.stringify({ executionIds: [] }),
					});
		appendLine(outputFd, {
			kind: "app-aux",
			startedMs: slot.startedMs,
			timestampMs: wallClockMs(),
			pressure: pressure?.status === 200 ? JSON.parse(pressure.body) : null,
			health:
				health === null
					? null
					: { status: health.status, ok: health.status === 200, latencyMs: health.latencyMs },
		});
	});

	await Promise.all([runtimeLoop, auxLoop]);
};
