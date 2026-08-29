/**
 * Creates the benchmark user, an API key, and the hermetic workload plugin on a deployed backend,
 * then writes their identifiers to a mode-0600 JSON file for `remote-probe.mjs`.
 *
 * Environment: E2E_API_URL, E2E_FRONTEND_URL, E2E_ADMIN_ACCESS_TOKEN.
 * Usage: bun run src/scripts/sandbox-amplification/remote-setup.ts <state.json>
 */
import { writeFileSync } from "node:fs";

import { UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Effect } from "effect";

import { createTestAuthClient, createTestUser, makeSession } from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { getApiUrl, getFrontendUrl } from "~/support/harness-target";

import { installBenchmarkWorkloadPlugin } from "../sandbox-resource-baseline/workload-plugin";

const statePath = process.argv[2];
if (!statePath) {
	throw new Error("usage: remote-setup.ts <state.json>");
}

const program = Effect.gen(function* () {
	const { token, userId, sessionCookie } = yield* createTestUser();
	const client = makeSession(
		getApiUrl(),
		{ Authorization: `Bearer ${token}` },
		UserId.make(userId),
	);
	// A production deployment rejects Better Auth mutations without the browser Origin.
	const authClient = createTestAuthClient(getApiUrl(), { sessionCookie, origin: getFrontendUrl() });
	const created = yield* Effect.promise(() =>
		authClient.apiKey.create({ name: "sandbox amplification probe" }),
	);
	const apiKey = requirePresent(created.data, "API key creation failed").key;
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
