import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";
import getPort from "get-port";

import {
	createAuthenticatedClient,
	createIntegration,
	getImportRun,
	installTestPluginBundle,
	listImportedEntityNames,
	pollImportRunUntilTerminal,
	pollUntil,
	sendDataWebhook,
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

const nativeEntities = (prefix: string) =>
	Array.from({ length: 120 }, (_, index) => ({
		properties: {},
		key: `record-${index}`,
		kind: "custom" as const,
		entitySchemaSlug: "collection",
		name: `${prefix} ${String(index).padStart(3, "0")}`,
	}));

const importWorkflowSource = (
	workflowScriptSlug: string,
	activityScriptSlug: string,
	workflowSlug: string,
) => `
import {
  genericImportActivityReference,
  genericImportCaptureReference,
  genericImportSealReference,
  genericImportWorkflowInputSchema,
  genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { Effect, Schema, defineManifest, defineScriptReference, defineWorkflow } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  capabilities: [],
  name: "E2E durable import",
  slug: ${JSON.stringify(workflowScriptSlug)},
});

const checkConfig = defineScriptReference({
  output: Schema.Null,
  input: Schema.Struct({ expectedValue: Schema.String }),
  scriptSlug: ${JSON.stringify(activityScriptSlug)},
});

const readSource = defineScriptReference({
  input: Schema.Struct({ artifactHandle: Schema.String }),
  output: Schema.Struct({ expectedValue: Schema.String, delayMs: Schema.Int }),
  scriptSlug: ${JSON.stringify(`${activityScriptSlug}-read`)},
});

export default defineWorkflow({
  manifest,
  input: genericImportWorkflowInputSchema,
  output: genericImportWorkflowResultSchema,
  run: (input, replay) =>
    Effect.gen(function* () {
      if (input.plan.operation !== ${JSON.stringify(workflowSlug)}) {
        return yield* Effect.fail(new Error("Import used an unexpected accepted plan"));
      }
       const sourcePayload = yield* replay.activity("read-source", readSource, {
         artifactHandle: input.sourcePayloadHandle,
       });
      const attribution = { runId: input.runId, command: input.command };

      yield* replay.child("capture-source", genericImportCaptureReference, {
        ...attribution,
        operation: {
          action: "capture",
          phase: "collection",
          ordinal: 0,
          captureId: "source-payload",
          handle: input.sourcePayloadHandle,
          checkpoint: { stage: "source-payload", source: input.source },
        },
      });
      yield* replay.child("record-reading", genericImportActivityReference, {
        ...attribution,
        operation: {
          action: "activity",
          activity: {
            id: "source-payload",
            kind: "reading",
            unit: "records",
            completed: 0,
            lastAdvancedAt: input.command.occurredAt,
             exactTotal: 1,
            wait: null,
            batchId: null,
            parentId: null,
            state: "running",
          },
        },
      });

      yield* replay.sleep("wait-before-config-read", sourcePayload.delayMs);
       yield* replay.activity("check-pinned-config", checkConfig, {
         expectedValue: sourcePayload.expectedValue,
       });
       yield* replay.child("record-reading-complete", genericImportActivityReference, {
         ...attribution,
         operation: {
           action: "activity",
           activity: {
             id: "source-payload", kind: "reading", unit: "records", completed: 1,
             lastAdvancedAt: input.command.occurredAt, exactTotal: 1,
             wait: null, batchId: null, parentId: null, state: "completed",
           },
         },
       });
      const sealed = yield* replay.child("seal-import", genericImportSealReference, {
        ...attribution,
        operation: { action: "seal" },
      });
      return { summary: sealed.summary, issues: [] };
    }),
});
`;

const configActivitySource = (activityScriptSlug: string) => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  capabilities: ["getPluginConfig"],
  name: "E2E durable import config check",
  slug: ${JSON.stringify(activityScriptSlug)},
});

export default defineScript({
  manifest,
  output: Schema.Null,
  input: Schema.Struct({ expectedValue: Schema.String }),
  run: (input, host) =>
    Effect.gen(function* () {
      const config = yield* host.getPluginConfig({ required: [${JSON.stringify(CONFIG_KEY)}] });
      if (config[${JSON.stringify(CONFIG_KEY)}] !== input.expectedValue) {
        return yield* Effect.fail(new Error("Import used an unexpected plugin configuration"));
      }
      return null;
    }),
});
`;

const readSourceActivity = (activityScriptSlug: string) => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { readArtifact } from "@ryot-app/sandbox-sdk/filesystem";

export const manifest = defineManifest({
  kind: "script", capabilities: ["artifact-read"],
  name: "E2E durable import source read",
  slug: ${JSON.stringify(`${activityScriptSlug}-read`)},
});
const sourceSchema = Schema.Struct({ expectedValue: Schema.String, delayMs: Schema.Int });
export default defineScript({
  manifest,
  input: Schema.Struct({ artifactHandle: Schema.String }),
  output: sourceSchema,
  run: () => Effect.gen(function* () {
    return yield* Schema.decodeEffect(Schema.fromJsonString(sourceSchema))(
      new TextDecoder("utf-8", { fatal: true }).decode(yield* readArtifact),
    );
  }),
});
`;

const waitForRunningImport = (client: Client, runId: string) =>
	pollUntil(
		`Import run '${runId}' to start`,
		Effect.gen(function* () {
			const run = (yield* getImportRun(client, runId, undefined, 10)).run;
			return run?.status === "running" &&
				run.activities.some(({ id, state }) => id === "source-payload" && state === "running")
				? run
				: null;
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
					files: {
						[activityEntry]: configActivitySource(activityScriptSlug),
						"backend/scripts/read-source.sandbox.ts": readSourceActivity(activityScriptSlug),
						[workflowEntry]: importWorkflowSource(
							workflowScriptSlug,
							activityScriptSlug,
							workflowSlug,
						),
					},
					importSources: [
						{
							workflowSlug,
							slug: sourceSlug,
							name: "E2E durable import",
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
					scripts: [
						{
							kind: "script",
							requiredPluginConfigKeys: [],
							capabilities: ["artifact-read"],
							slug: `${activityScriptSlug}-read`,
							name: "E2E durable import source read",
							entry: "backend/scripts/read-source.sandbox.ts",
						},
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
				const nativeIntegration = yield* createIntegration(client, {
					provider: "data-json",
					providerSpecifics: {},
				});
				const nativeDocument = {
					events: [],
					relationships: [],
					entities: nativeEntities("Native durable record"),
				};
				const nativeRunId = yield* sendDataWebhook(
					client,
					nativeIntegration,
					nativeDocument,
					"native-restart",
				);
				yield* pollUntil(
					"native import to commit before restart",
					Effect.gen(function* () {
						const run = (yield* getImportRun(client, nativeRunId, undefined, 10)).run;
						return run?.summary.some(
							({ unit, counts }) => unit === "entities" && counts.created > 0,
						)
							? run
							: null;
					}),
				);
				expect((yield* getImportRun(client, nativeRunId, undefined, 10)).run?.status).toBe(
					"running",
				);

				yield* stopApiProcess(processA);
				const processB = yield* startApi("Import Durability API B", NEW_CONFIG_VALUE);
				expect(yield* pollImportRunUntilTerminal(client, nativeRunId)).toMatchObject({
					status: "completed",
					summary: [
						{
							unit: "entities",
							recordKind: "entity",
							counts: { updated: 0, skipped: 0, created: 120, unchanged: 0, unsuccessful: 0 },
						},
					],
				});
				const nativeNames = yield* listImportedEntityNames(client, "collection");
				expect(nativeNames).toHaveLength(100);
				expect(new Set(nativeNames).size).toBe(100);
				expect(
					yield* sendDataWebhook(client, nativeIntegration, nativeDocument, "native-restart"),
				).toBe(nativeRunId);
				expect(yield* pollImportRunUntilTerminal(client, oldRun.id)).toMatchObject({
					summary: [],
					status: "completed",
					failureReason: null,
					activities: [
						{
							completed: 1,
							exactTotal: 1,
							kind: "reading",
							unit: "records",
							state: "completed",
							id: "source-payload",
						},
					],
				});

				const newRun = yield* client.call((c) =>
					c.imports.createRun({
						payload: { delayMs: 250, source: sourceSlug, expectedValue: NEW_CONFIG_VALUE },
					}),
				);
				expect(yield* pollImportRunUntilTerminal(client, newRun.id)).toMatchObject({
					summary: [],
					status: "completed",
					failureReason: null,
					activities: [
						{
							completed: 1,
							exactTotal: 1,
							kind: "reading",
							unit: "records",
							state: "completed",
							id: "source-payload",
						},
					],
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
				expect(cancelled).toMatchObject({ summary: [], status: "cancelled", failureReason: null });
				expect(cancelled.finishedAt).not.toBeNull();
				const nativeCancelledRunId = yield* sendDataWebhook(
					client,
					nativeIntegration,
					{ ...nativeDocument, entities: nativeEntities("Native cancelled record") },
					"native-cancel",
				);
				yield* pollUntil(
					"native import to commit before cancellation",
					Effect.gen(function* () {
						const run = (yield* getImportRun(client, nativeCancelledRunId, undefined, 10)).run;
						return run?.summary.some(
							({ unit, counts }) => unit === "entities" && counts.created > 0,
						)
							? run
							: null;
					}),
				);
				yield* client.call((c) =>
					c.imports.cancelRun({ params: { runId: ImportRunId.make(nativeCancelledRunId) } }),
				);
				const nativeCancelled = yield* pollImportRunUntilTerminal(client, nativeCancelledRunId);
				expect(nativeCancelled.status).toBe("cancelled");
				const entitySummary = nativeCancelled.summary.find(({ unit }) => unit === "entities");
				expect(entitySummary?.counts.created).toBeGreaterThan(0);
				expect(entitySummary?.counts.created).toBeLessThan(120);
				expect(entitySummary?.counts.unsuccessful).toBe(0);
			}),
		180_000,
	);
});
