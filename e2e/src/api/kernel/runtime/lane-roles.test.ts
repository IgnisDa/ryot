import type { ContractPayload } from "@ryot-app/contract/client";
import { EntitySchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Effect, FileSystem, Path } from "effect";
import getPort from "get-port";

import {
	adminHeaders,
	createAuthenticatedClient,
	createEntity,
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
	runMigrationProcess,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";
import { roleLogFile } from "~/support/role-logs";
import { webRequest } from "~/support/web-request";

type Lane = ContractPayload<"testSupport", "enqueueSandbox">["lane"];

const S3_BUCKET_NAME = "ryot-lane-roles-test";

const processorSource = (slug: string) => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { EventStreamStepInput, EventStreamStepOutput } from "@ryot-app/sandbox-sdk/event-streams";

export const manifest = defineManifest({ kind: "script", name: "Lane stream step", slug: ${JSON.stringify(slug)} });

export default defineScript({
  manifest,
  input: EventStreamStepInput,
  output: EventStreamStepOutput,
  run: () => Effect.succeed({ done: true, checkpoint: null, updates: [] }),
});
`;

const dispatcherSource = (slug: string, processorSlug: string) => `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
  EventStreamStepInput,
  EventStreamStepOutput,
  kernelDispatch,
} from "@ryot-app/sandbox-sdk/event-streams";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
import { defineScriptReference } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({ kind: "operation", name: "Lane dispatcher", slug: ${JSON.stringify(slug)} });

const processor = defineScriptReference({
  input: EventStreamStepInput,
  output: EventStreamStepOutput,
  scriptSlug: ${JSON.stringify(processorSlug)},
});

export default defineOperation({
  manifest,
  output: Schema.String,
  input: Schema.Struct({
    entityId: EventStreamStepInput.fields.entityId,
    eventSchemaSlug: EventStreamStepInput.fields.eventSchemaSlug,
  }),
  run: (input, host) => Effect.gen(function* () {
    const work = yield* host.requestEventStreamWork({ ...input, outputProperties: ["note"] }, processor);
    yield* (host.executeWorkflow?.("dispatch", kernelDispatch, { id: work.workId }) ??
      Effect.fail(new Error("executeWorkflow is unavailable")));
    return work.workId;
  }),
});
`;

describe("lane-pinned roles", () => {
	it.live(
		"runs each lane in its own process and resumes across the runner socket",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const infrastructure = yield* Effect.acquireRelease(
					startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
					stopCoreTestInfrastructure,
				);
				const socketDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-lanes-" });
				const interactivePort = yield* Effect.promise(() => getPort());
				const backgroundPort = yield* Effect.promise(() => getPort());
				const origin = `http://127.0.0.1:${interactivePort}`;
				const baseUrl = `${origin}/api`;
				const roleEnv = (role: Lane, port: number) =>
					buildApiEnv({
						port,
						frontendUrl: origin,
						label: `Lane ${role}`,
						dbUrl: infrastructure.dbUrl,
						s3BucketName: S3_BUCKET_NAME,
						redisUrl: infrastructure.redisUrl,
						s3Endpoint: infrastructure.s3Endpoint,
						extraEnv: { SERVER_LANES: role, SERVER_RUNNER_SOCKET_DIR: socketDirectory },
					});
				const interactiveEnv = roleEnv("interactive", interactivePort);
				const backgroundEnv = roleEnv("background", backgroundPort);
				const roleLog = (env: typeof interactiveEnv, role: Lane) =>
					roleLogFile(requirePresent(env.SERVER_LOG_FILE, "Role log file is unset"), role);

				yield* runMigrationProcess(interactiveEnv);

				yield* Effect.acquireRelease(
					Effect.gen(function* () {
						const process = spawnApiProcess(interactiveEnv);
						yield* waitForHealthCheck(
							`${baseUrl}/system/health`,
							"Lane interactive",
							process,
							90,
						).pipe(Effect.onError(() => stopApiProcess(process)));
						return process;
					}),
					stopApiProcess,
				);
				const background = yield* Effect.acquireRelease(
					Effect.sync(() => spawnApiProcess(backgroundEnv)),
					stopApiProcess,
				);
				const backgroundSocket = path.join(socketDirectory, "background.sock");
				yield* pollUntil(
					"background runner socket",
					Effect.gen(function* () {
						if (background.exitCode !== null) {
							return yield* Effect.die(
								new Error(`Background role exited with code ${background.exitCode}`),
							);
						}
						return (yield* fs.exists(backgroundSocket)) ? true : null;
					}),
					90_000,
				);

				const suffix = crypto.randomUUID();
				const entitySchemaSlug = `lane-entity-${suffix}`;
				const eventSchemaSlug = `lane-event-${suffix}`;
				const markerSlug = `lane-marker-${suffix}`;
				const processorSlug = `lane-processor-${suffix}`;
				const dispatcherSlug = `lane-dispatcher-${suffix}`;
				const plugin = yield* installTestPluginBundle({
					baseUrl,
					scope: "system",
					pluginSlug: `e2e-lane-roles-${suffix}`,
					operations: [
						{
							auth: "user",
							demoAccess: "allowed",
							slug: "lane-dispatch",
							scriptSlug: dispatcherSlug,
							description: "Dispatches lane-less event stream work",
						},
					],
					files: {
						"backend/scripts/marker.sandbox.ts": laneMarkerSource(markerSlug),
						"backend/scripts/processor.sandbox.ts": processorSource(processorSlug),
						"backend/scripts/dispatcher.sandbox.ts": dispatcherSource(
							dispatcherSlug,
							processorSlug,
						),
					},
					entitySchemas: [
						{
							icon: "box",
							name: "Lane entity",
							slug: entitySchemaSlug,
							propertiesSchema: { fields: {}, unknownKeys: "strict" },
							eventSchemas: [
								{
									name: "Lane event",
									slug: eventSchemaSlug,
									propertiesSchema: {
										unknownKeys: "strict",
										fields: { note: { label: "Note", type: "string", description: "Note" } },
									},
								},
							],
						},
					],
					scripts: [
						{
							kind: "script",
							slug: markerSlug,
							capabilities: [],
							name: "Lane marker",
							requiredPluginConfigKeys: [],
							entry: "backend/scripts/marker.sandbox.ts",
						},
						{
							kind: "script",
							capabilities: [],
							slug: processorSlug,
							name: "Lane stream step",
							requiredPluginConfigKeys: [],
							entry: "backend/scripts/processor.sandbox.ts",
						},
						{
							kind: "operation",
							slug: dispatcherSlug,
							name: "Lane dispatcher",
							requiredPluginConfigKeys: [],
							capabilities: ["requestEventStreamWork"],
							entry: "backend/scripts/dispatcher.sandbox.ts",
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
				const scriptId = (slug: string) =>
					requirePresent(plugin.scriptIds[slug], `Script '${slug}' was not installed`);
				const api = getApiClient(baseUrl);
				const runToCompletion = (input: { lane: Lane; slug: string; context: unknown }) =>
					Effect.gen(function* () {
						const startedAt = yield* Clock.currentTimeMillis;
						const { jobId, executionId } = yield* api.call(
							(c) =>
								c.testSupport.enqueueSandbox({
									payload: {
										lane: input.lane,
										context: input.context,
										scriptId: scriptId(input.slug),
										executingUserId: UserId.make(userId),
									},
								}),
							adminHeaders(),
						);
						const result = yield* pollUntil(
							`${input.lane} sandbox job`,
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
						const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;
						return { elapsedMs, executionId, value: requireCompletedSandboxValue(result) };
					});
				const loggedBy = (
					env: typeof interactiveEnv,
					role: Lane,
					executionId: string,
					marker: string,
				) =>
					Effect.gen(function* () {
						const logFile = yield* roleLog(env, role);
						if (!(yield* fs.exists(logFile))) {
							return false;
						}
						return (yield* fs.readFileString(logFile))
							.split("\n")
							.some((line) => line.includes(executionId) && line.includes(marker));
					});

				for (const [lane, runner, other, otherLane] of [
					["interactive", interactiveEnv, backgroundEnv, "background"],
					["background", backgroundEnv, interactiveEnv, "interactive"],
				] as const) {
					const marker = `lane-marker-${lane}-${crypto.randomUUID()}`;
					const run = yield* runToCompletion({ lane, slug: markerSlug, context: { marker } });
					expect(run.value).toBe(marker);
					yield* pollUntil(
						`${lane} run in its role log`,
						loggedBy(runner, lane, run.executionId, marker).pipe(
							Effect.map((logged) => (logged ? true : null)),
						),
						30_000,
					);
					expect(yield* loggedBy(other, otherLane, run.executionId, marker)).toBe(false);
				}

				const entity = yield* createEntity(client, {
					properties: {},
					name: "Lane entity",
					entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
				});
				for (let attempt = 0; attempt < 3; attempt += 1) {
					const run = yield* runToCompletion({
						lane: "interactive",
						slug: dispatcherSlug,
						context: { eventSchemaSlug, entityId: entity.id },
					});
					expect(typeof run.value).toBe("string");
					expect(run.elapsedMs).toBeLessThan(5_000);
				}

				const backgroundHealth = yield* webRequest(
					`http://127.0.0.1:${backgroundPort}/api/system/health`,
				).pipe(Effect.result);
				expect(backgroundHealth._tag).toBe("Failure");
				expect((yield* fs.stat(socketDirectory)).mode & 0o777).toBe(0o700);
				for (const role of ["interactive", "background"] as const) {
					const socket = yield* fs.stat(path.join(socketDirectory, `${role}.sock`));
					expect([socket.type, socket.mode & 0o777]).toEqual(["Socket", 0o600]);
				}
			}),
		300_000,
	);
});
