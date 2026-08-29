import { randomUUID } from "node:crypto";

import { TemporaryUploadToken } from "@ryot-app/contract/modules/uploads/schemas";
import {
	importRunRecipe,
	integrationImportRunsRecipe,
	manualImportRunsRecipe,
} from "@ryot-app/ryotql-recipes/import-runs";
import { Effect, Schema } from "effect";

import { getApiUrl } from "~/support/api";
import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { getApiClient } from "./contract-client";
import { pollUntil } from "./polling";
import { executeRyotQLRecipe } from "./ryotql";
import { installTestPluginBundle } from "./test-plugin";

export const FIXTURE_IMPORT_SOURCE = "e2e_archive_import_v2";
export const FIXTURE_CONFIG_IMPORT_SOURCE = "e2e_archive_import_config_v2";
export const FIXTURE_HANDLE_IMPORT_SOURCE = "e2e_harvest_handle_import_v1";

const FIXTURE_IMPORT_WORKFLOW_SOURCE = `
import {
  genericImportKernelInputSchema,
  genericImportWorkflowInputSchema,
  genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { Effect, Schema, defineManifest, defineWorkflow } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  capabilities: [],
  name: "E2E archive import",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  slug: "workflow.e2e-archive-import",
});

const kernelImport = {
  input: genericImportKernelInputSchema,
  output: genericImportWorkflowResultSchema,
  workflowSlug: "kernel:process-import-chunks",
};

const validateArchive = {
  input: Schema.Struct({}),
  output: Schema.Number,
  scriptSlug: "import.e2e-validate-archive",
};

export default defineWorkflow({
  manifest,
  input: genericImportWorkflowInputSchema,
  output: genericImportWorkflowResultSchema,
  run: (input, replay) =>
    Effect.gen(function* () {
      const archiveByteLength = yield* replay.activity("validate-archive", validateArchive, {});
      if (archiveByteLength === 0) {
        throw new Error("E2E archive is empty");
      }
      return yield* replay.child("complete-import", kernelImport, {
        totalItems: 0,
        failureCount: 0,
        chunkHandles: [],
        writeItemCount: 0,
        runId: input.runId,
      });
    }),
});
`;

const FIXTURE_IMPORT_VALIDATE_SOURCE = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { readNamedArtifact } from "@ryot-app/sandbox-sdk/filesystem";

export const manifest = defineManifest({
  kind: "script",
  capabilities: ["artifact-read"],
  name: "E2E validate archive",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  slug: "import.e2e-validate-archive",
});

export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Number,
  run: () => readNamedArtifact("archiveUploadToken").pipe(Effect.map((archive) => archive.byteLength)),
});
`;

export const installTestImportPlugin = Effect.suspend(() => {
	const entry = "scripts/import.sandbox.ts";
	const validateEntry = "scripts/validate-archive.sandbox.ts";
	return installTestPluginBundle({
		scope: "system",
		files: {
			[entry]: FIXTURE_IMPORT_WORKFLOW_SOURCE,
			[validateEntry]: FIXTURE_IMPORT_VALIDATE_SOURCE,
		},
		workflows: [{ slug: "import", scriptSlug: "workflow.e2e-archive-import" }],
		configSchema: {
			unknownKeys: "strict",
			fields: {
				fixtureToken: {
					type: "string",
					label: "Fixture token",
					validation: { required: true },
					description: "Intentionally absent E2E import configuration",
				},
			},
		},
		scripts: [
			{
				entry,
				kind: "workflow",
				capabilities: [],
				name: "E2E archive import",
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				slug: "workflow.e2e-archive-import",
			},
			{
				kind: "script",
				entry: validateEntry,
				name: "E2E validate archive",
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				capabilities: ["artifact-read"],
				slug: "import.e2e-validate-archive",
			},
		],
		importSources: [
			{
				name: "E2E archive",
				workflowSlug: "import",
				slug: FIXTURE_IMPORT_SOURCE,
				requiredPluginConfigKeys: [],
				description: "Import an E2E archive",
				inputSchema: {
					unknownKeys: "strict",
					fields: {
						archiveUploadToken: {
							type: "string",
							label: "E2E archive",
							description: "E2E archive CSV",
							validation: { minLength: 1, required: true },
							format: { kind: "upload", allowedFileExtensions: ["csv"] },
						},
					},
				},
			},
			{
				workflowSlug: "import",
				name: "E2E configured archive",
				slug: FIXTURE_CONFIG_IMPORT_SOURCE,
				requiredPluginConfigKeys: ["fixtureToken"],
				inputSchema: { fields: {}, unknownKeys: "strict" },
				description: "Import an E2E archive with required configuration",
			},
		],
	});
});

const FIXTURE_HANDLE_IMPORT_WORKFLOW_SOURCE = `
import {
  genericImportKernelInputSchema,
  genericImportWorkflowManifestSchema,
  genericImportWorkflowInputSchema,
  genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: "E2E harvest handle import",
  slug: "workflow.e2e-harvest-handle-import",
});

const writeChunk = {
  input: Schema.Struct({}),
  output: genericImportWorkflowManifestSchema,
  scriptSlug: "import.e2e-write-harvest-chunk",
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
      const manifest = yield* replay.activity("write-chunk", writeChunk, {});
      return yield* replay.child("process-chunk", kernelImport, {
        ...manifest,
        failRun: true,
        runId: input.runId,
      });
    }),
});
`;

const FIXTURE_HANDLE_IMPORT_CHUNK_SOURCE = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { writeScratchChunks } from "@ryot-app/sandbox-sdk/filesystem";
import { genericImportAdapterManifestSchema } from "@ryot-app/sandbox-sdk/imports";

export const manifest = defineManifest({
  kind: "script",
  capabilities: ["scratch"],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: "E2E write harvest chunk",
  slug: "import.e2e-write-harvest-chunk",
});

export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: genericImportAdapterManifestSchema,
  run: () =>
    writeScratchChunks([
      {
        name: "fixture.json",
        contents: JSON.stringify({
          failures: [
            {
              itemIndex: 0,
              stage: "input_transformation",
              sourceIdentifier: "fixture-0",
              sourceLabel: "Harvest fixture",
              message: "harvest handle fixture failure",
            },
          ],
          items: [],
        }),
      },
    ]).pipe(
      Effect.map(({ chunkFiles }) => ({
        chunkFiles,
        totalItems: 1,
        failureCount: 1,
        writeItemCount: 0,
      })),
    ),
});
`;

export const installTestHarvestHandleImportPlugin = Effect.suspend(() =>
	installTestPluginBundle({
		scope: "system",
		workflows: [{ slug: "import", scriptSlug: "workflow.e2e-harvest-handle-import" }],
		files: {
			"scripts/import.sandbox.ts": FIXTURE_HANDLE_IMPORT_WORKFLOW_SOURCE,
			"scripts/write-chunk.sandbox.ts": FIXTURE_HANDLE_IMPORT_CHUNK_SOURCE,
		},
		importSources: [
			{
				workflowSlug: "import",
				requiredPluginConfigKeys: [],
				name: "E2E harvest handle import",
				slug: FIXTURE_HANDLE_IMPORT_SOURCE,
				inputSchema: { fields: {}, unknownKeys: "strict" },
				description: "Import fixture for opaque harvest handles",
			},
		],
		scripts: [
			{
				kind: "workflow",
				capabilities: [],
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				name: "E2E harvest handle import",
				entry: "scripts/import.sandbox.ts",
				slug: "workflow.e2e-harvest-handle-import",
			},
			{
				kind: "script",
				capabilities: ["scratch"],
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				name: "E2E write harvest chunk",
				slug: "import.e2e-write-harvest-chunk",
				entry: "scripts/write-chunk.sandbox.ts",
			},
		],
	}),
);

const testImportPinningWorkflowSource = (scriptSlug: string) => `
import {
  genericImportKernelInputSchema,
  genericImportWorkflowInputSchema,
  genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { Effect, defineManifest, defineWorkflow } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  capabilities: [],
  name: "E2E import pinning",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  slug: ${JSON.stringify(scriptSlug)},
});

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
      yield* replay.sleep("hold-plugin-pin", 30_000);
      return yield* replay.child("complete-import", kernelImport, {
        totalItems: 0,
        failureCount: 0,
        chunkHandles: [],
        writeItemCount: 0,
        runId: input.runId,
      });
    }),
});
`;

export const installTestImportPinningPlugin = Effect.suspend(() => {
	const suffix = randomUUID();
	const source = `e2e_pinned_import_${suffix.replaceAll("-", "_")}`;
	const workflowSlug = `pinning-import-${suffix}`;
	const scriptSlug = `workflow.e2e-pinning-import-${suffix}`;
	const entry = `scripts/${workflowSlug}.sandbox.ts`;

	return installTestPluginBundle({
		scope: "system",
		workflows: [{ slug: workflowSlug, scriptSlug }],
		files: { [entry]: testImportPinningWorkflowSource(scriptSlug) },
		scripts: [
			{
				entry,
				slug: scriptSlug,
				kind: "workflow",
				capabilities: [],
				name: "E2E import pinning",
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
			},
		],
		importSources: [
			{
				slug: source,
				workflowSlug,
				name: "E2E import pinning",
				inputSchema: { fields: {}, unknownKeys: "strict" },
				requiredPluginConfigKeys: [],
				description: "Hold an accepted import open for plugin pinning coverage",
			},
		],
	}).pipe(Effect.map((plugin) => ({ plugin, source })));
});

export const uploadImportFile = (
	authToken: string,
	content: string,
	fileName: string,
	mimeType: string,
) =>
	Effect.gen(function* () {
		const headers = { Authorization: `Bearer ${authToken}` };
		const client = getApiClient();
		const intent = yield* client.call(
			(c) =>
				c.uploads.createIntent({
					payload: { fileName, kind: "temporary", contentType: mimeType },
				}),
			headers,
		);

		const uploadResponse = yield* Effect.promise(() =>
			fetch(new URL(intent.uploadUrl, `${getApiUrl()}/`), {
				body: content,
				method: intent.method,
				headers: intent.headers,
			}),
		);
		if (!uploadResponse.ok) {
			throw new Error(`Could not upload import file (${uploadResponse.status})`);
		}

		const completion = yield* client.call(
			(c) => c.uploads.completeIntent({ params: { intentId: intent.intentId } }),
			headers,
		);
		const { token } = yield* Schema.decodeUnknownEffect(TemporaryUploadToken)(completion);
		return token;
	});

export const listManualImportRuns = (client: Client, after: string | undefined, limit: number) =>
	executeRyotQLRecipe(client, manualImportRunsRecipe({ after, limit }));

export const listIntegrationImportRuns = (
	client: Client,
	integrationId: string,
	after: string | undefined,
	limit: number,
) => executeRyotQLRecipe(client, integrationImportRunsRecipe({ integrationId, after, limit }));

export const getImportRun = (
	client: Client,
	runId: string,
	failureAfter: string | undefined,
	failureLimit: number,
) => executeRyotQLRecipe(client, importRunRecipe({ runId, failureAfter, failureLimit }));

export const pollImportRunUntilTerminal = (client: Client, runId: string) =>
	pollUntil(
		`Import run '${runId}' to complete`,
		Effect.gen(function* () {
			const detail = yield* getImportRun(client, runId, undefined, 100);
			const run = requirePresent(detail.run, `Import run '${runId}' not found`);
			if (run.status === "completed" || run.status === "failed") {
				return run;
			}
			return null;
		}),
	);
