import { randomUUID } from "node:crypto";

import { ImportRunId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { requireObjectRecord, requirePresent, requireString } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";

import type { Client } from "./auth";
import { pollUntil } from "./polling";
import { installTestPluginBundle } from "./test-plugin";

export const FIXTURE_IMPORT_SOURCE = "e2e_archive_import_v2";
export const FIXTURE_CONFIG_IMPORT_SOURCE = "e2e_archive_import_config_v2";
export const FIXTURE_HANDLE_IMPORT_SOURCE = "e2e_harvest_handle_import_v1";

const FIXTURE_IMPORT_WORKFLOW_SOURCE = `
import {
  genericImportKernelInputSchema,
  genericImportWorkflowInputSchema,
  genericImportWorkflowResultSchema,
} from "@ryot/sandbox-sdk/imports";
import { defineManifest, defineWorkflow } from "@ryot/sandbox-sdk/workflow";

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

export default defineWorkflow({
  manifest,
  input: genericImportWorkflowInputSchema,
  output: genericImportWorkflowResultSchema,
  run: (input, replay) =>
    replay.child("complete-import", kernelImport, {
      totalItems: 0,
      failureCount: 0,
      chunkHandles: [],
      writeItemCount: 0,
      runId: input.runId,
    }),
});
`;

export const installTestImportPlugin = Effect.suspend(() => {
	const entry = "scripts/import.sandbox.ts";
	return installTestPluginBundle({
		files: { [entry]: FIXTURE_IMPORT_WORKFLOW_SOURCE },
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
		],
		importSources: [
			{
				lot: "named",
				input: "file",
				name: "E2E archive",
				workflowSlug: "import",
				slug: FIXTURE_IMPORT_SOURCE,
				requiredPluginConfigKeys: [],
				description: "Import an E2E archive",
				artifacts: [
					{
						required: true,
						key: "archiveFilePath",
						allowedFileExtensions: ["csv"],
						uploadTokenField: "archiveUploadToken",
					},
				],
			},
			{
				input: "payload",
				workflowSlug: "import",
				name: "E2E configured archive",
				slug: FIXTURE_CONFIG_IMPORT_SOURCE,
				requiredPluginConfigKeys: ["fixtureToken"],
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
} from "@ryot/sandbox-sdk/imports";
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot/sandbox-sdk/workflow";

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
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { writeScratchChunks } from "@ryot/sandbox-sdk/filesystem";
import { genericImportAdapterManifestSchema } from "@ryot/sandbox-sdk/imports";

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
		workflows: [{ slug: "import", scriptSlug: "workflow.e2e-harvest-handle-import" }],
		files: {
			"scripts/import.sandbox.ts": FIXTURE_HANDLE_IMPORT_WORKFLOW_SOURCE,
			"scripts/write-chunk.sandbox.ts": FIXTURE_HANDLE_IMPORT_CHUNK_SOURCE,
		},
		importSources: [
			{
				input: "payload",
				workflowSlug: "import",
				requiredPluginConfigKeys: [],
				name: "E2E harvest handle import",
				slug: FIXTURE_HANDLE_IMPORT_SOURCE,
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
} from "@ryot/sandbox-sdk/imports";
import { Effect, defineManifest, defineWorkflow } from "@ryot/sandbox-sdk/workflow";

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
				input: "payload",
				name: "E2E import pinning",
				requiredPluginConfigKeys: [],
				description: "Hold an accepted import open for plugin pinning coverage",
			},
		],
	}).pipe(Effect.map((plugin) => ({ plugin, source })));
});

const OPENSCALE_SAMPLE_CSV = `dateTime,weight,bmi,fat,water,muscle,comment
2026-04-01 08:00:00,75.0,22.5,15.0,60.0,40.0,Morning weight
2026-04-02 08:00:00,74.8,22.4,14.9,60.2,40.1,
2026-04-03 08:00:00,75.2,22.6,15.1,60.0,40.0,After lunch
`;

export const uploadImportFile = (
	cookies: string,
	content: string,
	fileName: string,
	mimeType: string,
) =>
	Effect.gen(function* () {
		const intentResponse = yield* Effect.promise(() =>
			fetch(`${getBackendUrl()}/uploads/intents`, {
				method: "POST",
				headers: { Cookie: cookies, "content-type": "application/json" },
				body: JSON.stringify({
					fileName,
					kind: "temporary",
					provider: "local",
					contentType: mimeType,
				}),
			}),
		);
		if (!intentResponse.ok) {
			throw new Error(`Could not create upload intent (${intentResponse.status})`);
		}
		const intent = requireObjectRecord(
			yield* Effect.promise(() => intentResponse.json()),
			"Upload intent response is invalid",
		);
		const intentId = requireString(intent.intentId, "Upload intent id is missing");
		const method = requireString(intent.method, "Upload intent method is missing");
		const uploadUrl = requireString(intent.uploadUrl, "Upload intent URL is missing");
		const headers = Object.fromEntries(
			Object.entries(requireObjectRecord(intent.headers, "Upload intent headers are invalid")).map(
				([key, value]) => [key, requireString(value, `Upload intent header '${key}' is invalid`)],
			),
		);

		const uploadResponse = yield* Effect.promise(() =>
			fetch(new URL(uploadUrl, `${getBackendUrl()}/`), { method, headers, body: content }),
		);
		if (!uploadResponse.ok) {
			throw new Error(`Could not upload import file (${uploadResponse.status})`);
		}

		const completeResponse = yield* Effect.promise(() =>
			fetch(`${getBackendUrl()}/uploads/intents/${intentId}/complete`, {
				method: "POST",
				headers: { Cookie: cookies },
			}),
		);
		if (!completeResponse.ok) {
			throw new Error(`Could not complete upload intent (${completeResponse.status})`);
		}
		const completion = requireObjectRecord(
			yield* Effect.promise(() => completeResponse.json()),
			"Upload completion response is invalid",
		);
		return requireString(completion.token, "Upload token is missing");
	});

export const startOpenScaleImport = (client: Client, uploadToken: string) =>
	Effect.gen(function* () {
		const result = yield* client.call((c) =>
			c.imports.createRun({ payload: { source: "open_scale", uploadToken } }),
		);

		return requirePresent(result.id, "Import run id is missing");
	});

export const getImportRun = (client: Client, runId: string) =>
	client.call((c) => c.imports.getRun({ params: { runId: ImportRunId.make(runId) }, query: {} }));

export const pollImportRunUntilTerminal = (client: Client, runId: string) =>
	pollUntil(
		`Import run '${runId}' to complete`,
		Effect.gen(function* () {
			const run = yield* getImportRun(client, runId);
			if (run.status === "completed" || run.status === "failed") {
				return run;
			}
			return null;
		}),
	);

export const runOpenScaleImportFixture = (client: Client, cookies: string) =>
	Effect.gen(function* () {
		const uploadToken = yield* uploadImportFile(
			cookies,
			OPENSCALE_SAMPLE_CSV,
			"openscale-export.csv",
			"text/csv",
		);

		const runId = yield* startOpenScaleImport(client, uploadToken);
		const completedRun = yield* pollImportRunUntilTerminal(client, runId);
		return { runId, completedRun };
	});

const HEVY_SAMPLE_CSV = `title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_order,weight_kg,reps,set_type,distance_m,duration_seconds
Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,Good session,Bench Press,,Felt strong,1,100,5,normal,,
Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,Good session,Bench Press,,,2,100,5,normal,,
Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,Good session,Squat,,,1,140,3,normal,,
`;

export const runHevyImportFixture = (client: Client, cookies: string) =>
	Effect.gen(function* () {
		const uploadToken = yield* uploadImportFile(
			cookies,
			HEVY_SAMPLE_CSV,
			"hevy-export.csv",
			"text/csv",
		);

		const result = yield* client.call((c) =>
			c.imports.createRun({ payload: { source: "hevy", uploadToken } }),
		);
		const runId = requirePresent(result.id, "Import run id is missing");

		const completedRun = yield* pollImportRunUntilTerminal(client, runId);
		return { runId, completedRun };
	});
