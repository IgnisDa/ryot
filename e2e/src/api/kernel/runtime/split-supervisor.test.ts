import type { ContractPayload } from "@ryot-app/contract/client";
import { UserId } from "@ryot-app/contract/schema/brands";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect, FileSystem } from "effect";
import getPort from "get-port";

import {
	adminHeaders,
	createAuthenticatedClient,
	getApiClient,
	installTestPluginBundle,
	laneMarkerSource,
	listInstalledPlugins,
	pollUntil,
	requireCompletedSandboxValue,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";
import { roleLogFile } from "~/support/role-logs";

type Lane = ContractPayload<"testSupport", "enqueueSandbox">["lane"];

const S3_BUCKET_NAME = "ryot-split-supervisor-test";

const logTimestamps = (contents: string) =>
	contents.split("\n").flatMap((line) => {
		const value = /(?:^|\s)timestamp=(\S+)/.exec(line)?.[1];
		return value === undefined ? [] : [Date.parse(value)];
	});

const listProcesses = () =>
	new TextDecoder()
		.decode(Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,ni="]).stdout)
		.split("\n")
		.flatMap((line) => {
			const [pid, parent, niceness] = line.trim().split(/\s+/).map(Number);
			return pid === undefined || parent === undefined || niceness === undefined
				? []
				: [{ pid, parent, niceness }];
		});

describe("split supervisor", () => {
	it.live(
		"runs migrations, then both roles with the background role at low priority",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const infrastructure = yield* Effect.acquireRelease(
					startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
					stopCoreTestInfrastructure,
				);
				const socketDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-split-" });
				const port = yield* Effect.promise(() => getPort());
				const origin = `http://127.0.0.1:${port}`;
				const baseUrl = `${origin}/api`;
				const env = buildApiEnv({
					port,
					frontendUrl: origin,
					label: "Split supervisor",
					dbUrl: infrastructure.dbUrl,
					s3BucketName: S3_BUCKET_NAME,
					redisUrl: infrastructure.redisUrl,
					s3Endpoint: infrastructure.s3Endpoint,
					extraEnv: {
						SERVER_LANES: "split",
						SANDBOX_MEMORY_BUDGET_MIB: "1904",
						SERVER_RUNNER_SOCKET_DIR: socketDirectory,
					},
				});
				const baseLog = requirePresent(env.SERVER_LOG_FILE, "Log file is unset");
				const supervisor = yield* Effect.acquireRelease(
					Effect.sync(() => spawnApiProcess(env)),
					stopApiProcess,
				);
				yield* waitForHealthCheck(`${baseUrl}/system/health`, "Split", supervisor, 120);

				const interactiveLog = yield* roleLogFile(baseLog, "interactive");
				const backgroundLog = yield* roleLogFile(baseLog, "background");
				const firstTimestamps = (logFile: string) =>
					fs.readFileString(logFile).pipe(
						Effect.orElseSucceed(() => ""),
						Effect.map((contents) => {
							const timestamps = logTimestamps(contents);
							return timestamps.length === 0 ? null : timestamps;
						}),
					);
				const migrationTimestamps = yield* pollUntil(
					"migration log",
					firstTimestamps(baseLog),
					60_000,
				);
				const roleTimestamps = [
					...(yield* pollUntil("interactive role log", firstTimestamps(interactiveLog), 60_000)),
					...(yield* pollUntil("background role log", firstTimestamps(backgroundLog), 60_000)),
				];
				const migrationEnded = Math.max(...migrationTimestamps);
				const rolesStarted = Math.min(...roleTimestamps);
				expect(migrationEnded).toBeLessThanOrEqual(rolesStarted);

				const suffix = crypto.randomUUID();
				const markerSlug = `split-marker-${suffix}`;
				const plugin = yield* installTestPluginBundle({
					baseUrl,
					scope: "system",
					pluginSlug: `e2e-split-supervisor-${suffix}`,
					files: { "backend/scripts/marker.sandbox.ts": laneMarkerSource(markerSlug) },
					scripts: [
						{
							kind: "script",
							slug: markerSlug,
							capabilities: [],
							name: "Lane marker",
							requiredPluginConfigKeys: [],
							entry: "backend/scripts/marker.sandbox.ts",
						},
					],
				});
				const { client, userId } = yield* createAuthenticatedClient(baseUrl);
				yield* pollUntil(
					"system plugin installation for the test user",
					listInstalledPlugins(client, { includeHidden: true }).pipe(
						Effect.map((installations) =>
							installations.some(
								({ slug, health }) => slug === plugin.pluginSlug && health === "ready",
							)
								? true
								: null,
						),
					),
					60_000,
				);
				const api = getApiClient(baseUrl);
				const runMarker = (lane: Lane, marker: string) =>
					Effect.gen(function* () {
						const { jobId, executionId } = yield* api.call(
							(c) =>
								c.testSupport.enqueueSandbox({
									payload: {
										lane,
										context: { marker },
										executingUserId: UserId.make(userId),
										scriptId: requirePresent(plugin.scriptIds[markerSlug], "Script missing"),
									},
								}),
							adminHeaders(),
						);
						const result = yield* pollUntil(
							`${lane} sandbox job`,
							api
								.call(
									(c) =>
										c.testSupport.getSandboxResult({
											query: { executingUserId: UserId.make(userId) },
											params: { jobId: requirePresent(jobId, "Sandbox job was not enqueued") },
										}),
									adminHeaders(),
								)
								.pipe(Effect.map((current) => (current.status === "pending" ? null : current))),
							60_000,
						);
						expect(requireCompletedSandboxValue(result)).toBe(marker);
						return executionId;
					});
				const loggedIn = (logFile: string, executionId: string, marker: string) =>
					fs
						.readFileString(logFile)
						.pipe(
							Effect.map((contents) =>
								contents
									.split("\n")
									.some((line) => line.includes(executionId) && line.includes(marker)),
							),
						);
				for (const [lane, ownLog, otherLog] of [
					["interactive", interactiveLog, backgroundLog],
					["background", backgroundLog, interactiveLog],
				] as const) {
					const marker = `split-marker-${lane}-${crypto.randomUUID()}`;
					const executionId = yield* runMarker(lane, marker);
					yield* pollUntil(
						`${lane} run in its role log`,
						loggedIn(ownLog, executionId, marker).pipe(
							Effect.map((logged) => (logged ? true : null)),
						),
						30_000,
					);
					expect(yield* loggedIn(otherLog, executionId, marker)).toBe(false);
				}

				const children = listProcesses().filter(({ parent }) => parent === supervisor.pid);
				expect(sortBy(children.map(({ niceness }) => niceness))).toEqual([0, 19]);
				const lowPriority = requirePresent(
					children.find(({ niceness }) => niceness === 19),
					"No background role process",
				);
				const interactivePid = requirePresent(
					children.find(({ niceness }) => niceness === 0),
					"No interactive role process",
				).pid;

				process.kill(lowPriority.pid, "SIGKILL");
				const exitCode = yield* Effect.promise(() => supervisor.exited);
				expect(exitCode).not.toBe(0);
				yield* pollUntil(
					"interactive role termination",
					Effect.sync(() =>
						listProcesses().some(({ pid }) => pid === interactivePid) ? null : true,
					),
					60_000,
				);
			}),
		300_000,
	);
});
