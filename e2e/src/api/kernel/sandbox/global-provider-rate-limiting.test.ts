import type { ChildProcess } from "node:child_process";

import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginSlug, type SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Duration, Effect } from "effect";
import getPort from "get-port";

import {
	adminHeaders,
	createAuthenticatedClient,
	encodePluginSourceFiles,
	encodeTestSupportPluginFiles,
	getApiClient,
	httpCallFailureSandboxSource,
	httpCallSandboxSource,
	installTestPlugin,
	makeSession,
	pollSandboxResult,
	pollUntil,
	requireCompletedSandboxValue,
	testPluginManifest,
	type ContractSession,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { assertTaggedError, requireObjectRecord, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import {
	type FakeHttpServer,
	startFakeHttpServer,
	startFakeHttpServerScoped,
} from "~/support/fake-http-server";
import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

type PluginHttpRateLimit = PluginManifest["httpRateLimits"][number];

const ISOLATED_BUCKET_NAME = "ryot-global-rate-limit-test";

const installHttpScriptScoped = (input: {
	url: string;
	name: string;
	slug: string;
	failure?: boolean;
	pluginSlug?: string;
	httpRateLimits?: Array<PluginHttpRateLimit>;
}) => {
	const source = (input.failure ? httpCallFailureSandboxSource : httpCallSandboxSource)({
		url: input.url,
		name: input.name,
		slug: input.slug,
	});
	return Effect.acquireRelease(
		installTestPlugin({
			source,
			scope: "system",
			pluginSlug: input.pluginSlug,
			httpRateLimits: input.httpRateLimits,
			script: {
				kind: "script",
				name: input.name,
				slug: input.slug,
				capabilities: ["httpCall"],
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
			},
		}),
		uninstallTestPlugin,
	);
};

const getSandboxResultAt = (client: ContractSession, userId: string, jobId: string) =>
	client.call(
		(c) =>
			c.testSupport.getSandboxResult({
				params: { jobId },
				query: { executingUserId: UserId.make(userId) },
			}),
		adminHeaders(),
	);

const enqueueSandboxAt = (client: ContractSession, userId: string, scriptId: SandboxScriptId) =>
	client.call(
		(c) =>
			c.testSupport.enqueueSandbox({ payload: { scriptId, executingUserId: UserId.make(userId) } }),
		adminHeaders(),
	);

const pollSandboxResultAt = (client: ContractSession, userId: string, jobId: string) =>
	pollUntil(
		`sandbox job '${jobId}'`,
		getSandboxResultAt(client, userId, jobId).pipe(
			Effect.map((result) => (result.status === "pending" ? null : result)),
		),
	);

const waitForRequestCount = (label: string, timestamps: Array<number>, count: number) =>
	pollUntil(
		label,
		Effect.sync(() => (timestamps.length >= count ? [...timestamps] : null)),
	);

const expectSuccessfulHttpCall = (value: unknown) => {
	const result = requireObjectRecord(value, "Expected an HTTP call result object");
	expect(result).toMatchObject({ success: true, data: { status: 200 } });
};

describe("deployment-global sandbox HTTP rate limiting", () => {
	it.live("shares one evenly spaced schedule across users and atomically rejects conflicts", () =>
		Effect.gen(function* () {
			const timestamps: Array<number> = [];
			const http = yield* startFakeHttpServerScoped(() => {
				timestamps.push(Date.now());
				return Response.json({ ok: true });
			});
			const key = `e2e.global.${crypto.randomUUID()}`;
			const slug = `global-rate-limit-${crypto.randomUUID()}`;
			const pluginSlug = `e2e-global-rate-limit-${crypto.randomUUID()}`;
			const declaration = {
				key,
				requests: 1,
				intervalMs: 2_000,
				origins: [new URL(http.url).origin],
			};
			const plugin = yield* installHttpScriptScoped({
				slug,
				pluginSlug,
				name: "Global rate limit",
				httpRateLimits: [declaration],
				url: `${http.url}/provider/catalog`,
			});
			const conflictingPluginSlug = `e2e-global-rate-limit-conflict-${crypto.randomUUID()}`;
			const conflictingSlug = `global-rate-limit-conflict-${crypto.randomUUID()}`;
			const conflictingSource = httpCallSandboxSource({
				slug: conflictingSlug,
				url: `${http.url}/provider/conflict`,
				name: "Conflicting global rate limit",
			});
			const conflict = yield* Effect.flip(
				installTestPlugin({
					scope: "system",
					source: conflictingSource,
					pluginSlug: conflictingPluginSlug,
					httpRateLimits: [{ ...declaration, intervalMs: 1_600 }],
					script: {
						kind: "script",
						slug: conflictingSlug,
						capabilities: ["httpCall"],
						requiredPluginConfigKeys: [],
						requiredSystemConfigKeys: [],
						name: "Conflicting global rate limit",
					},
				}),
			);
			assertTaggedError(conflict, "PluginRequestError");
			expect(conflict.reason.code).toBe("validation-failed");

			const activePlugins = yield* getApiClient().call(
				(c) => c.testSupport.listSystemPlugins({}),
				adminHeaders(),
			);
			expect(activePlugins.some(({ slug: activeSlug }) => activeSlug === pluginSlug)).toBe(true);
			expect(
				activePlugins.some(({ slug: activeSlug }) => activeSlug === conflictingPluginSlug),
			).toBe(false);

			const users = yield* Effect.all(
				Array.from({ length: 3 }, () => createAuthenticatedClient()),
				{ concurrency: "unbounded" },
			);
			const jobs = yield* Effect.forEach(
				users,
				({ userId }) =>
					enqueueSandboxAt(getApiClient(), userId, plugin.scriptId).pipe(
						Effect.map(({ jobId }) => ({ jobId, userId })),
					),
				{ concurrency: "unbounded" },
			);
			const values = yield* Effect.forEach(
				jobs,
				({ jobId, userId }) =>
					pollSandboxResult(userId, jobId).pipe(Effect.map(requireCompletedSandboxValue)),
				{ concurrency: "unbounded" },
			);
			for (const value of values) {
				expectSuccessfulHttpCall(value);
			}
			expect(timestamps).toHaveLength(3);
			const gaps = timestamps
				.slice(1)
				.map(
					(timestamp, index) => timestamp - requirePresent(timestamps[index], "Missing timestamp"),
				);
			for (const gap of gaps) {
				expect(gap).toBeGreaterThanOrEqual(1_500);
			}
		}),
	);

	it.live("durably retries a matched 429 while an unmatched job completes", () =>
		Effect.gen(function* () {
			const retryTimestamps: Array<number> = [];
			const retryServer = yield* startFakeHttpServerScoped(() => {
				retryTimestamps.push(Date.now());
				return retryTimestamps.length === 1
					? new Response("rate limited", { status: 429, headers: { "Retry-After": "4" } })
					: Response.json({ ok: true });
			});
			const unmatchedTimestamps: Array<number> = [];
			const unmatchedServer = yield* startFakeHttpServerScoped(() => {
				unmatchedTimestamps.push(Date.now());
				return Response.json({ ok: true });
			});
			const matchedSlug = `retry-after-${crypto.randomUUID()}`;
			const matched = yield* installHttpScriptScoped({
				failure: true,
				slug: matchedSlug,
				name: "Retry after",
				url: `${retryServer.url}/provider/retry`,
				httpRateLimits: [
					{
						requests: 1,
						intervalMs: 500,
						key: `e2e.retry.${crypto.randomUUID()}`,
						origins: [new URL(retryServer.url).origin],
					},
				],
			});
			const unmatchedSlug = `retry-unmatched-${crypto.randomUUID()}`;
			const unmatched = yield* installHttpScriptScoped({
				slug: unmatchedSlug,
				name: "Retry unmatched",
				url: `${unmatchedServer.url}/integration/trusted`,
			});
			const [matchedUser, unmatchedUser] = yield* Effect.all([
				createAuthenticatedClient(),
				createAuthenticatedClient(),
			]);
			const matchedJob = yield* enqueueSandboxAt(
				getApiClient(),
				matchedUser.userId,
				matched.scriptId,
			);
			yield* waitForRequestCount("initial rate-limited request", retryTimestamps, 1);
			yield* Effect.sleep(Duration.millis(250));
			expect(
				(yield* getSandboxResultAt(getApiClient(), matchedUser.userId, matchedJob.jobId)).status,
			).toBe("pending");

			const unmatchedJob = yield* enqueueSandboxAt(
				getApiClient(),
				unmatchedUser.userId,
				unmatched.scriptId,
			);
			expectSuccessfulHttpCall(
				requireCompletedSandboxValue(
					yield* pollSandboxResult(unmatchedUser.userId, unmatchedJob.jobId),
				),
			);
			expect(unmatchedTimestamps).toHaveLength(1);
			expect(retryTimestamps).toHaveLength(1);
			expect(
				(yield* getSandboxResultAt(getApiClient(), matchedUser.userId, matchedJob.jobId)).status,
			).toBe("pending");

			expectSuccessfulHttpCall(
				requireCompletedSandboxValue(
					yield* pollSandboxResult(matchedUser.userId, matchedJob.jobId),
				),
			);
			expect(retryTimestamps).toHaveLength(2);
			expect(
				requirePresent(retryTimestamps[1], "Missing retry timestamp") -
					requirePresent(retryTimestamps[0], "Missing retry timestamp"),
			).toBeGreaterThanOrEqual(3_500);
		}),
	);

	it.live("leaves an unmatched trusted local destination unrestricted and does not retry 429", () =>
		Effect.gen(function* () {
			const timestamps: Array<number> = [];
			const http = yield* startFakeHttpServerScoped(() => {
				timestamps.push(Date.now());
				return new Response("rate limited", { status: 429 });
			});
			const slug = `unmatched-integration-${crypto.randomUUID()}`;
			const plugin = yield* installHttpScriptScoped({
				slug,
				failure: true,
				name: "Unmatched trusted integration",
				url: `${http.url}/integration/trusted-webhook`,
			});
			const users = yield* Effect.all(
				Array.from({ length: 3 }, () => createAuthenticatedClient()),
				{ concurrency: "unbounded" },
			);
			const jobs = yield* Effect.forEach(
				users,
				({ userId }) =>
					enqueueSandboxAt(getApiClient(), userId, plugin.scriptId).pipe(
						Effect.map(({ jobId }) => ({ jobId, userId })),
					),
				{ concurrency: "unbounded" },
			);
			const values = yield* Effect.forEach(
				jobs,
				({ jobId, userId }) =>
					pollSandboxResult(userId, jobId).pipe(Effect.map(requireCompletedSandboxValue)),
				{ concurrency: "unbounded" },
			);
			for (const value of values) {
				expect(value).toMatchObject({
					success: false,
					error: "HTTP 429",
					data: { status: 429, body: "rate limited" },
				});
			}
			expect(timestamps).toHaveLength(3);
			yield* Effect.sleep(Duration.seconds(1));
			expect(timestamps).toHaveLength(3);
		}),
	);
});

describe("isolated deployment-global sandbox HTTP rate limiting", () => {
	let apiPortA: number;
	let apiPortB: number;
	let apiEnvA: NodeJS.ProcessEnv;
	let apiEnvB: NodeJS.ProcessEnv;
	let httpServer: FakeHttpServer | undefined;
	const requestTimestamps: Array<number> = [];
	let apiProcessA: ChildProcess | undefined;
	let apiProcessB: ChildProcess | undefined;
	let coreInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

	const apiOriginA = () => `http://127.0.0.1:${apiPortA}`;
	const apiOriginB = () => `http://127.0.0.1:${apiPortB}`;
	const apiUrlA = () => `http://127.0.0.1:${apiPortA}/api`;
	const apiUrlB = () => `http://127.0.0.1:${apiPortB}/api`;

	beforeAll(async () => {
		try {
			httpServer = await startFakeHttpServer(() => {
				requestTimestamps.push(Date.now());
				return Response.json({ ok: true });
			});
			const [infrastructure, portA, portB] = await Promise.all([
				startCoreTestInfrastructure({ bucketName: ISOLATED_BUCKET_NAME }),
				getPort(),
				getPort(),
			]);
			apiPortA = portA;
			apiPortB = portB;
			coreInfrastructure = infrastructure;
			apiEnvA = buildApiEnv({
				port: apiPortA,
				frontendUrl: apiOriginA(),
				dbUrl: infrastructure.dbUrl,
				label: "Global Rate Limit API A",
				redisUrl: infrastructure.redisUrl,
				s3BucketName: ISOLATED_BUCKET_NAME,
				s3Endpoint: infrastructure.s3Endpoint,
				extraEnv: { SCHEDULER_DISABLE_DISPATCHERS: "true" },
			});
			// Both processes share a FRONTEND_URL: the internal OAuth client and API resource are
			// provisioned from it, as they are for replicas of a single deployment.
			apiEnvB = buildApiEnv({
				port: apiPortB,
				frontendUrl: apiOriginA(),
				dbUrl: infrastructure.dbUrl,
				label: "Global Rate Limit API B",
				redisUrl: infrastructure.redisUrl,
				s3BucketName: ISOLATED_BUCKET_NAME,
				s3Endpoint: infrastructure.s3Endpoint,
				extraEnv: { SCHEDULER_DISABLE_DISPATCHERS: "true" },
			});
			apiProcessA = spawnApiProcess(apiEnvA);
			await waitForHealthCheck(`${apiOriginA()}/api/system/health`, "Global Rate Limit API A", 90);
			apiProcessB = spawnApiProcess(apiEnvB);
			await waitForHealthCheck(`${apiOriginB()}/api/system/health`, "Global Rate Limit API B", 90);
		} catch (error) {
			await Promise.allSettled([stopApiProcess(apiProcessA), stopApiProcess(apiProcessB)]);
			httpServer?.stop();
			await stopCoreTestInfrastructure(coreInfrastructure).catch(() => undefined);
			throw error;
		}
	}, 180_000);

	afterAll(async () => {
		await Promise.allSettled([stopApiProcess(apiProcessA), stopApiProcess(apiProcessB)]);
		httpServer?.stop();
		await stopCoreTestInfrastructure(coreInfrastructure).catch(() => undefined);
	});

	it.live(
		"shares Redis admission across processes and resumes a future reservation after restart",
		() =>
			Effect.gen(function* () {
				const http = requirePresent(httpServer, "Isolated HTTP server is not initialised");
				const slug = `isolated-rate-limit-${crypto.randomUUID()}`;
				const pluginSlug = `e2e-isolated-rate-limit-${crypto.randomUUID()}`;
				const source = httpCallSandboxSource({
					slug,
					name: "Isolated global rate limit",
					url: `${http.url}/provider/isolated`,
				});
				const entry = "scripts/isolated-rate-limit.sandbox.ts";
				const manifest = testPluginManifest({
					pluginSlug,
					httpRateLimits: [
						{
							requests: 1,
							intervalMs: 60_000,
							origins: [new URL(http.url).origin],
							key: `e2e.isolated.${crypto.randomUUID()}`,
						},
					],
					scripts: [
						{
							slug,
							entry,
							kind: "script",
							capabilities: ["httpCall"],
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							name: "Isolated global rate limit",
						},
					],
				});
				const clientA = makeSession(apiUrlA());
				yield* clientA.call(
					(c) =>
						c.testSupport.installSystemPlugin({
							payload: {
								manifest,
								files: encodeTestSupportPluginFiles(encodePluginSourceFiles({ [entry]: source })),
							},
						}),
					adminHeaders(),
				);
				yield* Effect.addFinalizer(() =>
					makeSession(apiUrlA())
						.call(
							(c) =>
								c.testSupport.uninstallSystemPlugin({
									params: { pluginSlug: PluginSlug.make(pluginSlug) },
								}),
							adminHeaders(),
						)
						.pipe(Effect.catch(() => Effect.void)),
				);
				const scripts = yield* clientA.call(
					(c) => c.testSupport.listSandboxScripts({ query: {} }),
					adminHeaders(),
				);
				const scriptId = requirePresent(
					scripts.find((script) => script.slug === slug && script.source === source)?.id,
					"Isolated rate-limit script was not installed",
				);
				const [userA, userB] = yield* Effect.all([
					createAuthenticatedClient(apiUrlA()),
					createAuthenticatedClient(apiUrlA()),
				]);
				const firstJob = yield* enqueueSandboxAt(clientA, userA.userId, scriptId);
				expectSuccessfulHttpCall(
					requireCompletedSandboxValue(
						yield* pollSandboxResultAt(clientA, userA.userId, firstJob.jobId),
					),
				);
				expect(requestTimestamps).toHaveLength(1);

				yield* Effect.promise(() => stopApiProcess(apiProcessA));
				const clientB = makeSession(apiUrlB());
				const secondJob = yield* enqueueSandboxAt(clientB, userB.userId, scriptId);
				yield* Effect.sleep(Duration.seconds(1));
				expect((yield* getSandboxResultAt(clientB, userB.userId, secondJob.jobId)).status).toBe(
					"pending",
				);
				expect(requestTimestamps).toHaveLength(1);
				const pressure = yield* clientB.call(
					(c) =>
						c.testSupport.sampleOperationalPressure({
							payload: { executionIds: [secondJob.executionId] },
						}),
					adminHeaders(),
				);
				expect(pressure.sandbox.activeExecutions).toBe(0);

				yield* Effect.promise(() => stopApiProcess(apiProcessB));
				apiProcessA = spawnApiProcess(apiEnvA);
				yield* Effect.promise(() =>
					waitForHealthCheck(
						`${apiOriginA()}/api/system/health`,
						"Global Rate Limit API A Restart",
						90,
					),
				);
				const restartedClientA = makeSession(apiUrlA());
				expectSuccessfulHttpCall(
					requireCompletedSandboxValue(
						yield* pollSandboxResultAt(restartedClientA, userB.userId, secondJob.jobId),
					),
				);
				expect(requestTimestamps).toHaveLength(2);
				expect(
					requirePresent(requestTimestamps[1], "Missing request timestamp") -
						requirePresent(requestTimestamps[0], "Missing request timestamp"),
				).toBeGreaterThanOrEqual(58_500);
			}),
	);
});
