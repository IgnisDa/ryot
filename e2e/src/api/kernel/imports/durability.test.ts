import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";
import getPort from "get-port";

import {
	createAuthenticatedClient,
	getImportRun,
	installTestPluginBundle,
	pollImportRunUntilTerminal,
	pollUntil,
	type Client,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";
import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const CONFIG_KEY = "fixtureValue";
const OLD_CONFIG_VALUE = "old-value";
const NEW_CONFIG_VALUE = "new-value";
const S3_BUCKET_NAME = "ryot-import-durability-test";

const importWorkflowSource = (workflowScriptSlug: string, activityScriptSlug: string) => `
import {
  genericImportKernelInputSchema,
  genericImportWorkflowInputSchema,
  genericImportWorkflowManifestSchema,
  genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { Effect, Schema, defineManifest, defineWorkflow } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  capabilities: [],
  name: "E2E durable import",
  requiredPluginConfigKeys: [],
  slug: ${JSON.stringify(workflowScriptSlug)},
});

const checkConfig = {
  output: genericImportWorkflowManifestSchema,
  input: Schema.Struct({ expectedValue: Schema.String }),
  scriptSlug: ${JSON.stringify(activityScriptSlug)},
};

const kernelImport = {
  input: genericImportKernelInputSchema,
  output: genericImportWorkflowResultSchema,
  workflowSlug: "kernel:process-import-chunks",
};

export default defineWorkflow({
  manifest,
  input: genericImportWorkflowInputSchema,
  output: genericImportWorkflowResultSchema,
  run: (input, replay) =>
    Effect.gen(function* () {
      const expectedValue = input.sourcePayload?.["expectedValue"];
      const delayMs = input.sourcePayload?.["delayMs"];
      if (typeof expectedValue !== "string" || typeof delayMs !== "number") {
        return yield* Effect.fail(new Error("Invalid durable import input"));
      }

      yield* replay.sleep("wait-before-config-read", delayMs);
      const importManifest = yield* replay.activity("check-pinned-config", checkConfig, {
        expectedValue,
      });
      return yield* replay.child("complete-import", kernelImport, {
        ...importManifest,
        runId: input.runId,
        command: input.command,
      });
    }),
});
`;

const configActivitySource = (activityScriptSlug: string) => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { genericImportWorkflowManifestSchema } from "@ryot-app/sandbox-sdk/imports";

export const manifest = defineManifest({
  kind: "script",
  capabilities: ["getPluginConfig"],
  name: "E2E durable import config check",
  slug: ${JSON.stringify(activityScriptSlug)},
  requiredPluginConfigKeys: [${JSON.stringify(CONFIG_KEY)}],
});

export default defineScript({
  manifest,
  output: genericImportWorkflowManifestSchema,
  input: Schema.Struct({ expectedValue: Schema.String }),
  run: (input, host) =>
    Effect.gen(function* () {
      const config = yield* host.getPluginConfig([${JSON.stringify(CONFIG_KEY)}]);
      if (config[${JSON.stringify(CONFIG_KEY)}] !== input.expectedValue) {
        return yield* Effect.fail(new Error("Import used an unexpected plugin configuration"));
      }
      return {
        totalItems: 0,
        failureCount: 0,
        chunkHandles: [],
        writeItemCount: 0,
      };
    }),
});
`;

const waitForRunningImport = (client: Client, runId: string) =>
	pollUntil(
		`Import run '${runId}' to start`,
		Effect.gen(function* () {
			const run = (yield* getImportRun(client, runId, undefined, 10)).run;
			return run?.status === "running" ? run : null;
		}),
	);

describe("isolated import durability", () => {
	it.live(
		"pins configuration and preserves cancellation across API restarts",
		() =>
			Effect.gen(function* () {
				const infrastructure = yield* Effect.acquireRelease(
					startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
					stopCoreTestInfrastructure,
				);
				const port = yield* Effect.promise(() => getPort());
				const origin = `http://127.0.0.1:${port}`;
				const baseUrl = `${origin}/api`;
				const suffix = crypto.randomUUID();
				const pluginSlug = `e2e-import-durability-${suffix}`;
				const sourceSlug = `e2e_import_durability_${suffix.replaceAll("-", "_")}`;
				const workflowSlug = `durable-import-${suffix}`;
				const workflowScriptSlug = `workflow.e2e-durable-import-${suffix}`;
				const activityScriptSlug = `import.e2e-durable-config-${suffix}`;
				const workflowEntry = "backend/scripts/durable-import.sandbox.ts";
				const activityEntry = "backend/scripts/durable-config.sandbox.ts";
				const configEnvironmentKey = pluginConfigEnvironmentKey(pluginSlug, CONFIG_KEY);

				const apiEnv = (label: string, configValue: string) =>
					buildApiEnv({
						port,
						label,
						frontendUrl: origin,
						dbUrl: infrastructure.dbUrl,
						s3BucketName: S3_BUCKET_NAME,
						redisUrl: infrastructure.redisUrl,
						s3Endpoint: infrastructure.s3Endpoint,
						extraEnv: { [configEnvironmentKey]: configValue },
					});
				const startApi = (label: string, configValue: string) =>
					Effect.acquireRelease(
						Effect.gen(function* () {
							const process = spawnApiProcess(apiEnv(label, configValue));
							yield* waitForHealthCheck(`${baseUrl}/system/health`, label, process, 90).pipe(
								Effect.onError(() => stopApiProcess(process)),
							);
							return process;
						}),
						stopApiProcess,
					);

				const processA = yield* startApi("Import Durability API A", OLD_CONFIG_VALUE);
				yield* installTestPluginBundle({
					baseUrl,
					pluginSlug,
					scope: "system",
					workflows: [{ slug: workflowSlug, scriptSlug: workflowScriptSlug }],
					files: {
						[activityEntry]: configActivitySource(activityScriptSlug),
						[workflowEntry]: importWorkflowSource(workflowScriptSlug, activityScriptSlug),
					},
					configSchema: {
						unknownKeys: "strict",
						fields: {
							[CONFIG_KEY]: {
								type: "string",
								label: "Fixture value",
								validation: { required: true },
								description: "Configuration pinned by the durable import run",
							},
						},
					},
					scripts: [
						{
							kind: "workflow",
							capabilities: [],
							entry: workflowEntry,
							slug: workflowScriptSlug,
							name: "E2E durable import",
							requiredPluginConfigKeys: [],
						},
						{
							kind: "script",
							entry: activityEntry,
							slug: activityScriptSlug,
							capabilities: ["getPluginConfig"],
							requiredPluginConfigKeys: [CONFIG_KEY],
							name: "E2E durable import config check",
						},
					],
					importSources: [
						{
							workflowSlug,
							slug: sourceSlug,
							name: "E2E durable import",
							requiredPluginConfigKeys: [CONFIG_KEY],
							description: "Exercise import recovery and configuration pinning",
							inputSchema: {
								unknownKeys: "strict",
								fields: {
									expectedValue: {
										type: "string",
										label: "Expected value",
										validation: { required: true },
										description: "Expected pinned configuration value",
									},
									delayMs: {
										label: "Delay",
										type: "integer",
										validation: { minimum: 0, required: true },
										description: "Durable delay before reading configuration",
									},
								},
							},
						},
					],
				});

				const { client } = yield* createAuthenticatedClient(baseUrl);
				const oldRun = yield* client.call((c) =>
					c.imports.createRun({
						payload: { delayMs: 30_000, source: sourceSlug, expectedValue: OLD_CONFIG_VALUE },
					}),
				);
				yield* waitForRunningImport(client, oldRun.id);
				yield* Effect.sleep(1_000);
				expect((yield* getImportRun(client, oldRun.id, undefined, 10)).run?.status).toBe("running");

				yield* stopApiProcess(processA);
				const processB = yield* startApi("Import Durability API B", NEW_CONFIG_VALUE);
				expect(yield* pollImportRunUntilTerminal(client, oldRun.id)).toMatchObject({
					progress: 100,
					importedItems: 0,
					processedItems: 0,
					status: "completed",
					failureReason: null,
				});

				const newRun = yield* client.call((c) =>
					c.imports.createRun({
						payload: { delayMs: 250, source: sourceSlug, expectedValue: NEW_CONFIG_VALUE },
					}),
				);
				expect(yield* pollImportRunUntilTerminal(client, newRun.id)).toMatchObject({
					progress: 100,
					importedItems: 0,
					processedItems: 0,
					status: "completed",
					failureReason: null,
				});

				const cancelledRun = yield* client.call((c) =>
					c.imports.createRun({
						payload: { delayMs: 120_000, source: sourceSlug, expectedValue: NEW_CONFIG_VALUE },
					}),
				);
				yield* waitForRunningImport(client, cancelledRun.id);
				yield* Effect.sleep(1_000);
				expect((yield* getImportRun(client, cancelledRun.id, undefined, 10)).run?.status).toBe(
					"running",
				);

				yield* stopApiProcess(processB);
				yield* startApi("Import Durability API C", NEW_CONFIG_VALUE);
				yield* client.call((c) =>
					c.imports.cancelRun({ params: { runId: ImportRunId.make(cancelledRun.id) } }),
				);
				const cancelled = yield* pollImportRunUntilTerminal(client, cancelledRun.id);
				expect(cancelled).toMatchObject({
					importedItems: 0,
					processedItems: 0,
					status: "cancelled",
					failureReason: null,
				});
				expect(cancelled.finishedAt).not.toBeNull();
			}),
		180_000,
	);
});
