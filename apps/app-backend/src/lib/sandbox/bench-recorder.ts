// TEMP(sandbox-benchmark): per-execution timing capture for benchmarking the
// sandbox completion timeline. Disabled unless the sentinel file exists, so it
// is a no-op in normal/prod operation. Toggle at runtime with no restart:
//   enable:  touch /tmp/ryot-sandbox-bench.on
//   disable: rm   /tmp/ryot-sandbox-bench.on
// Remove this file and its call sites in service.ts once benchmarking is done.
import { appendFileSync, existsSync } from "node:fs";

const sentinelPath = process.env.RYOT_SANDBOX_BENCH_SENTINEL ?? "/tmp/ryot-sandbox-bench.on";
const outputPath = process.env.RYOT_SANDBOX_BENCH_FILE ?? "/tmp/ryot-sandbox-bench.jsonl";

export type SandboxBenchSample = {
	ts: number;
	scriptId: string;
	driverName: string;
	success: boolean;
	poolHit: boolean;
	hostCalls: number;
	totalMs: number;
	processMs: number;
	hostSetupMs: number;
	scriptExecMs: number;
	startupMs: number;
	memRssBytes: number;
	memHeapBytes: number;
	scriptSlug: string | null;
	phase: string | null;
	origin: string | null;
	eventSchemaSlug: string | null;
	entitySchemaSlug: string | null;
};

export const recordSandboxBenchSample = (sample: SandboxBenchSample) => {
	try {
		if (!existsSync(sentinelPath)) {
			return;
		}
		appendFileSync(outputPath, `${JSON.stringify(sample)}\n`);
	} catch {
		// Never let benchmark recording interfere with sandbox execution.
	}
};
