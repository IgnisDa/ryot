/**
 * Creates two benchmark users, each with an API key and its own private hermetic workload plugin,
 * plus one system workload plugin carrying the rate-limited book provider, on a deployed backend.
 * Writes the identifiers to a mode-0600 JSON file for `remote-probe.mjs`.
 *
 * Environment: E2E_API_URL, E2E_FRONTEND_URL, E2E_ADMIN_ACCESS_TOKEN.
 * Usage: bun run src/scripts/sandbox-admission/remote-setup.ts <state.json>
 */
import { writeFileSync } from "node:fs";

import { UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Effect } from "effect";

import {
	adminHeaders,
	createTestAuthClient,
	createTestUser,
	getApiClient,
	listInstalledPlugins,
	makeSession,
	pollUntil,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { getApiUrl, getFrontendUrl } from "~/support/harness-target";

import { installBenchmarkWorkloadPlugin } from "../sandbox-resource-baseline/workload-plugin";

/** Six calls one request per five seconds apart keep a slow import waiting for about 25 seconds. */
const SLOW_PROVIDER = {
	calls: 6,
	intervalMs: 5_000,
	url: "http://127.0.0.1:8000/api/system/health",
};

const statePath = process.argv[2];
if (!statePath) {
	throw new Error("usage: remote-setup.ts <state.json>");
}

const setupUser = (label: string) =>
	Effect.gen(function* () {
		const { token, userId, sessionCookie } = yield* createTestUser();
		const client = makeSession(
			getApiUrl(),
			{ Authorization: `Bearer ${token}` },
			UserId.make(userId),
		);
		// A production deployment rejects Better Auth mutations without the browser Origin.
		const authClient = createTestAuthClient(getApiUrl(), {
			sessionCookie,
			origin: getFrontendUrl(),
		});
		const created = yield* Effect.promise(() =>
			authClient.apiKey.create({ name: `sandbox admission probe ${label}` }),
		);
		const apiKey = requirePresent(created.data, "API key creation failed").key;
		const runId = `adm-${label}-${yield* Clock.currentTimeMillis}`;
		const plugin = yield* installBenchmarkWorkloadPlugin({ runId, client });
		return { client, userId, apiKey, bookProviderId: plugin.bookProviderId };
	});

const program = Effect.gen(function* () {
	const { client, ...bulk } = yield* setupUser("bulk");
	const { client: _other, ...other } = yield* setupUser("other");
	const slow = yield* installBenchmarkWorkloadPlugin({
		client,
		slowProvider: SLOW_PROVIDER,
		runId: `adm-slow-${yield* Clock.currentTimeMillis}`,
	});
	// Users created before a system plugin need their installation reconciled before they can import.
	yield* getApiClient().call((c) => c.testSupport.reconcilePluginInstallations(), adminHeaders());
	yield* pollUntil(
		"rate-limited workload plugin installation",
		listInstalledPlugins(client).pipe(
			Effect.map((installations) =>
				installations.find(({ slug }) => slug === slow.pluginSlug)?.health === "ready"
					? true
					: null,
			),
		),
	);
	const slowBookProviderId = requirePresent(
		slow.slowBookProviderId,
		"Rate-limited book provider was not installed",
	);
	writeFileSync(statePath, JSON.stringify({ other, bulk: { ...bulk, slowBookProviderId } }), {
		mode: 0o600,
	});
	yield* Effect.log(JSON.stringify({ bulk: bulk.userId, other: other.userId }));
});

await Effect.runPromise(program);
