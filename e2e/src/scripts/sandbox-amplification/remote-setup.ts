/**
 * Creates the benchmark user, an API key, and the hermetic workload plugin on a deployed backend,
 * then writes their identifiers to a mode-0600 JSON file for `remote-probe.mjs`.
 *
 * Environment: E2E_API_URL, E2E_FRONTEND_URL, E2E_ADMIN_ACCESS_TOKEN.
 * Usage: bun run src/scripts/sandbox-amplification/remote-setup.ts <state.json>
 */
import { writeFileSync } from "node:fs";

import { Clock, Effect } from "effect";

import { createApiKey, createTestUser, makeSession } from "~/fixtures/kernel";
import { getApiUrl } from "~/support/harness-target";

import { installBenchmarkWorkloadPlugin } from "../sandbox-resource-baseline/workload-plugin";

const statePath = process.argv[2];
if (!statePath) {
	throw new Error("usage: remote-setup.ts <state.json>");
}

const program = Effect.gen(function* () {
	const { token, userId, sessionCookie } = yield* createTestUser();
	const client = makeSession(getApiUrl(), { Authorization: `Bearer ${token}` });
	const apiKey = yield* createApiKey(sessionCookie, "sandbox amplification probe");
	const runId = `amp-${yield* Clock.currentTimeMillis}`;
	const plugin = yield* installBenchmarkWorkloadPlugin({ runId, client });
	writeFileSync(
		statePath,
		JSON.stringify({
			userId,
			apiKey,
			scriptId: plugin.scriptId,
			bookProviderId: plugin.bookProviderId,
		}),
		{ mode: 0o600 },
	);
	yield* Effect.log(JSON.stringify({ userId, scriptId: plugin.scriptId }));
});

await Effect.runPromise(program);
