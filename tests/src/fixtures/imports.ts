import { ImportRunId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";

import type { Client } from "./auth";
import { pollUntil } from "./polling";
import { installTestPluginBundle } from "./test-plugin";

export const FIXTURE_IMPORT_SOURCE = "e2e_archive_import_v2";
export const FIXTURE_CONFIG_IMPORT_SOURCE = "e2e_archive_import_config_v2";

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
      chunkFiles: [],
      failureCount: 0,
      writeItemCount: 0,
      runId: input.runId,
    }),
});
`;

export const installTestImportPlugin = () => {
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
};

const OPENSCALE_SAMPLE_CSV = `dateTime,weight,bmi,fat,water,muscle,comment
2026-04-01 08:00:00,75.0,22.5,15.0,60.0,40.0,Morning weight
2026-04-02 08:00:00,74.8,22.4,14.9,60.2,40.1,
2026-04-03 08:00:00,75.2,22.6,15.1,60.0,40.0,After lunch
`;

export const uploadTemporaryFile = (
	cookies: string,
	content: string,
	fileName: string,
	mimeType: string,
) =>
	Effect.gen(function* () {
		const formData = new FormData();
		formData.append("files[]", new File([content], fileName, { type: mimeType }), fileName);

		const response = yield* Effect.promise(() =>
			fetch(`${getBackendUrl()}/uploads/temporary`, {
				body: formData,
				method: "POST",
				headers: { Cookie: cookies },
			}),
		);

		const tokens: string[] = yield* Effect.promise(() => response.json());
		return requirePresent(tokens[0], "Upload token is missing");
	});

export const startOpenScaleImport = (client: Client, uploadToken: string) =>
	Effect.gen(function* () {
		const result = yield* client.call((c) =>
			c.imports.createRun({ payload: { source: "open_scale", uploadToken } }),
		);

		return requirePresent(result.id, "Import run id is missing");
	});

export const getImportRun = (client: Client, runId: string) =>
	client.call((c) => c.imports.getRun({ path: { runId: ImportRunId.make(runId) }, urlParams: {} }));

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
		const uploadToken = yield* uploadTemporaryFile(
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
		const uploadToken = yield* uploadTemporaryFile(
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
