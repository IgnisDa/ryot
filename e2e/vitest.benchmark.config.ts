import shared from "@ryot-app/testing/vitest.shared";
import { defineConfig, mergeConfig } from "vitest/config";

const srcDir = Bun.fileURLToPath(new URL("./src/", import.meta.url));
const sandboxReplayBenchmark = process.env.SANDBOX_REPLAY_BENCHMARK === "1";

export default mergeConfig(
	shared,
	defineConfig({
		resolve: { alias: [{ find: /^~\//, replacement: srcDir }] },
		test: {
			maxWorkers: 1,
			isolate: false,
			hookTimeout: 180_000,
			testTimeout: 3_630_000,
			reporters: ["hanging-process", "default"],
			globalSetup: ["./benchmark-global-setup.ts"],
			include: sandboxReplayBenchmark
				? ["src/api/kernel/sandbox/short-wait-replay.test.ts"]
				: ["src/api/plugins/media/imports/media-population-benchmark.test.ts"],
			...(sandboxReplayBenchmark
				? { testNamePattern: /short_wait_workload_records_replays_time_and_memory/ }
				: {}),
		},
	}),
);
