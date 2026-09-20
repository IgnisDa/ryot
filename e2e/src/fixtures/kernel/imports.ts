import { IngestionIssue } from "@ryot-app/contract/modules/imports/ingestion";
import { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import { TemporaryUploadToken } from "@ryot-app/contract/modules/uploads/schemas";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import {
	importRunRecipe,
	importIssuesRecipe,
	integrationImportRunsRecipe,
	manualImportRunsRecipe,
} from "@ryot-app/ryotql-recipes/import-runs";
import type { GenericImportWriteItem } from "@ryot-app/sandbox-sdk/imports";
import { Effect, Result, Schema } from "effect";

import { requirePresent } from "~/support/assertions";
import { getApiUrl } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

import type { Client } from "./auth";
import { getApiClient } from "./contract-client";
import { pollUntil } from "./polling";
import { executeRyotQLRecipe } from "./ryotql";
import { providerSandboxSource } from "./sandbox-provider";
import { installTestPluginBundle } from "./test-plugin";

export const FIXTURE_IMPORT_SOURCE = "e2e_archive_import_v2";

export const importIssuesExportSchema = Schema.Struct({
	runId: ImportRunId,
	source: Schema.String,
	issues: Schema.Array(IngestionIssue),
	failureReason: Schema.NullOr(ImportRunFailureReason),
});
export const FIXTURE_CONFIG_IMPORT_SOURCE = "e2e_archive_import_config_v2";
export const FIXTURE_HANDLE_IMPORT_SOURCE = "e2e_harvest_handle_import_v1";

const PARTIAL_RESULT_COMMITTED_ITEM_COUNT = 10;

const FIXTURE_IMPORT_WORKFLOW_SOURCE = `
import {
  genericImportSealReference,
  genericImportWorkflowInputSchema,
  genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { Effect, Schema, defineExecutableAlternatives, defineManifest, defineScriptReference, defineWorkflow, defineWorkflowReference, selectExecutable } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  name: "E2E archive import",
  slug: "workflow.e2e-archive-import",
});

const validateArchive = defineExecutableAlternatives({ id: "archive-validator", stage: "settings", references: { archive: defineScriptReference({
  input: Schema.Struct({}),
  output: Schema.Number,
  scriptSlug: "import.e2e-validate-archive",
}), configured: defineScriptReference({ input: Schema.Struct({}), output: Schema.Number, scriptSlug: "import.e2e-configured" }) } });

export default defineWorkflow({
  manifest,
  input: genericImportWorkflowInputSchema,
  output: genericImportWorkflowResultSchema,
  run: (input, replay) =>
    Effect.gen(function* () {
      const archiveByteLength = yield* replay.activity("validate-archive", selectExecutable(validateArchive, input.source === "${FIXTURE_CONFIG_IMPORT_SOURCE}" ? "configured" : "archive"), {});
      if (archiveByteLength === 0) {
        throw new Error("E2E archive is empty");
      }
       const sealed = yield* replay.child("complete-import", genericImportSealReference, {
         operation: { action: "seal" },
         runId: input.runId,
         command: input.command,
       });
       return { summary: sealed.summary, issues: [] };
    }),
});
`;

const FIXTURE_IMPORT_VALIDATE_SOURCE = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { readNamedArtifact } from "@ryot-app/sandbox-sdk/filesystem";

export const manifest = defineManifest({
  kind: "script",
  name: "E2E validate archive",
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
	const entry = "backend/scripts/import.sandbox.ts";
	const validateEntry = "backend/scripts/validate-archive.sandbox.ts";
	return installTestPluginBundle({
		scope: "system",
		workflows: [{ slug: "import", scriptSlug: "workflow.e2e-archive-import" }],
		configSchema: {
			unknownKeys: "strict",
			fields: {
				fixtureToken: {
					type: "string",
					label: "Fixture token",
					description: "Intentionally absent E2E import configuration",
				},
			},
		},
		scripts: [
			{
				kind: "script",
				name: "Configured import",
				requiredPluginConfigKeys: [],
				slug: "import.e2e-configured",
				capabilities: ["getPluginConfig"],
				entry: "backend/scripts/configured.sandbox.ts",
			},
			{
				entry,
				kind: "workflow",
				capabilities: [],
				name: "E2E archive import",
				requiredPluginConfigKeys: [],
				slug: "workflow.e2e-archive-import",
			},
			{
				kind: "script",
				entry: validateEntry,
				name: "E2E validate archive",
				requiredPluginConfigKeys: [],
				capabilities: ["artifact-read"],
				slug: "import.e2e-validate-archive",
			},
		],
		files: {
			[entry]: FIXTURE_IMPORT_WORKFLOW_SOURCE,
			[validateEntry]: FIXTURE_IMPORT_VALIDATE_SOURCE,
			"backend/scripts/configured.sandbox.ts": `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({ kind: "script", slug: "import.e2e-configured", name: "Configured import" });
export default defineScript({ manifest, input: Schema.Struct({}), output: Schema.Number, run: (_input, host) => host.getPluginConfig({ required: ["fixtureToken"] }).pipe(Effect.as(1)) });
`,
		},
		importSources: [
			{
				name: "E2E archive",
				workflowSlug: "import",
				slug: FIXTURE_IMPORT_SOURCE,
				description: "Import an E2E archive",
				plan: { selections: { "archive-validator": { value: "archive" } } },
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
				inputSchema: { fields: {}, unknownKeys: "strict" },
				description: "Import an E2E archive with required configuration",
				plan: { selections: { "archive-validator": { value: "configured" } } },
			},
		],
	});
});

const FIXTURE_HANDLE_IMPORT_WORKFLOW_SOURCE = `
import {
  genericImportApplyReference,
  genericImportCaptureReference,
  genericImportSealReference,
  genericImportWorkflowInputSchema,
  genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  name: "E2E harvest handle import",
  slug: "workflow.e2e-harvest-handle-import",
});

const writeChunk = {
  referenceKind: "script" as const,
  input: Schema.Struct({}),
   output: Schema.Struct({ chunkHandles: Schema.Array(Schema.String) }),
  scriptSlug: "import.e2e-write-harvest-chunk",
};

export default defineWorkflow({
  manifest,
  input: genericImportWorkflowInputSchema,
  output: genericImportWorkflowResultSchema,
  run: (input, replay) =>
    Effect.gen(function* () {
       const { chunkHandles: handles } = yield* replay.activity("write-chunk", writeChunk, {});
       const attribution = { runId: input.runId, command: input.command };
       for (const [ordinal, handle] of handles.entries()) {
         const captured = yield* replay.child("capture-" + ordinal, genericImportCaptureReference, {
           ...attribution,
           operation: { action: "capture", phase: "application", ordinal, handle, captureId: "chunk-" + ordinal, checkpoint: {} },
         });
         yield* replay.child("apply-" + ordinal, genericImportApplyReference, {
           ...attribution,
           operation: { action: "apply", ordinal, batchId: "batch-" + ordinal, captureId: captured.captureId, inputFingerprint: captured.inputFingerprint },
         });
       }
       const sealed = yield* replay.child("seal", genericImportSealReference, { ...attribution, operation: { action: "seal" } });
       return { summary: sealed.summary, issues: [] };
    }),
});
`;

const fixtureHandleImportChunkSource = (failureCount: number) => {
	const failures = Array.from({ length: failureCount }, (_, index) => ({
		unit: "records",
		itemIndex: index,
		recordKind: "record",
		stage: "input_transformation",
		sourceIdentifier: `fixture-${index}`,
		message: "harvest handle fixture failure",
		sourceLabel: `Harvest fixture ${index + 1}`,
	}));
	return `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { sandboxScratchManifestSchema, writeScratchChunks } from "@ryot-app/sandbox-sdk/filesystem";

export const manifest = defineManifest({
  kind: "script",
  name: "E2E write harvest chunk",
  slug: "import.e2e-write-harvest-chunk",
});

export default defineScript({
  manifest,
  input: Schema.Struct({}),
   output: sandboxScratchManifestSchema,
  run: () =>
     Effect.gen(function* () {
       const failures = ${JSON.stringify(failures)};
       const chunks: { name: string; contents: string }[] = [];
       for (let offset = 0; offset < failures.length; offset += 100) {
         chunks.push({ name: "fixture-" + offset + ".json", contents: JSON.stringify({ failures: failures.slice(offset, offset + 100), items: [] }) });
       }
       return yield* writeScratchChunks(chunks);
     }),
});
`;
};

export const installTestHarvestHandleImportPlugin = (
	failureCount = 1,
	sourceSlug = FIXTURE_HANDLE_IMPORT_SOURCE,
) =>
	Effect.suspend(() =>
		installTestPluginBundle({
			scope: "system",
			workflows: [{ slug: "import", scriptSlug: "workflow.e2e-harvest-handle-import" }],
			files: {
				"backend/scripts/import.sandbox.ts": FIXTURE_HANDLE_IMPORT_WORKFLOW_SOURCE,
				"backend/scripts/write-chunk.sandbox.ts": fixtureHandleImportChunkSource(failureCount),
			},
			importSources: [
				{
					slug: sourceSlug,
					workflowSlug: "import",
					name: "E2E harvest handle import",
					inputSchema: { fields: {}, unknownKeys: "strict" },
					description: "Import fixture for opaque harvest handles",
				},
			],
			scripts: [
				{
					kind: "workflow",
					capabilities: [],
					requiredPluginConfigKeys: [],
					name: "E2E harvest handle import",
					entry: "backend/scripts/import.sandbox.ts",
					slug: "workflow.e2e-harvest-handle-import",
				},
				{
					kind: "script",
					capabilities: ["scratch"],
					requiredPluginConfigKeys: [],
					name: "E2E write harvest chunk",
					slug: "import.e2e-write-harvest-chunk",
					entry: "backend/scripts/write-chunk.sandbox.ts",
				},
			],
		}),
	);

const partialResultCancellationWorkflowSource = (
	workflowScriptSlug: string,
	chunkScriptSlug: string,
) => `
import {
  genericImportApplyReference,
  genericImportCaptureReference,
  genericImportSealReference,
  genericImportWorkflowInputSchema,
  genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  name: "E2E partial-result cancellation import",
  slug: ${JSON.stringify(workflowScriptSlug)},
});

const writeChunk = {
  referenceKind: "script" as const,
  input: Schema.Struct({}),
   output: Schema.Struct({ chunkHandles: Schema.Array(Schema.String) }),
  scriptSlug: ${JSON.stringify(chunkScriptSlug)},
};

export default defineWorkflow({
  manifest,
  input: genericImportWorkflowInputSchema,
  output: genericImportWorkflowResultSchema,
  run: (input, replay) =>
    Effect.gen(function* () {
       const written = yield* replay.activity("write-chunk", writeChunk, {});
       const attribution = { runId: input.runId, command: input.command };
       for (const [ordinal, handle] of written.chunkHandles.entries()) {
       const captured = yield* replay.child("capture-" + ordinal, genericImportCaptureReference, {
         ...attribution,
         operation: { action: "capture", phase: "application", ordinal, handle, captureId: "chunk-" + ordinal, checkpoint: {} },
       });
       yield* replay.child("apply-" + ordinal, genericImportApplyReference, {
         ...attribution,
         operation: { action: "apply", ordinal, batchId: "batch-" + ordinal, captureId: captured.captureId, inputFingerprint: captured.inputFingerprint },
       });
       }
       const sealed = yield* replay.child("seal", genericImportSealReference, { ...attribution, operation: { action: "seal" } });
       return { summary: sealed.summary, issues: [] };
    }),
});
`;

const partialResultCancellationChunkSource = (
	chunkScriptSlug: string,
	items: GenericImportWriteItem[],
) => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { sandboxScratchManifestSchema, writeScratchChunks } from "@ryot-app/sandbox-sdk/filesystem";

export const manifest = defineManifest({
  kind: "script",
  name: "E2E partial-result cancellation chunk",
  slug: ${JSON.stringify(chunkScriptSlug)},
});

export default defineScript({
  manifest,
  input: Schema.Struct({}),
   output: sandboxScratchManifestSchema,
  run: () =>
     writeScratchChunks(${JSON.stringify([
				{
					name: "committed.json",
					contents: JSON.stringify({
						failures: [],
						items: items.slice(0, PARTIAL_RESULT_COMMITTED_ITEM_COUNT),
					}),
				},
				{
					name: "blocked.json",
					contents: JSON.stringify({
						failures: [],
						items: items.slice(PARTIAL_RESULT_COMMITTED_ITEM_COUNT),
					}),
				},
			])}),
});
`;

export const installTestPartialResultCancellationImportPlugin = Effect.suspend(() => {
	const suffix = crypto.randomUUID();
	const entitySchemaSlug = `e2e-import-cancellation-${suffix}`;
	const providerSlug = `${entitySchemaSlug}.provider`;
	const source = `e2e_partial_result_cancellation_${suffix.replaceAll("-", "_")}`;
	const workflowSlug = `partial-result-cancellation-${suffix}`;
	const workflowScriptSlug = `workflow.e2e-partial-result-cancellation-${suffix}`;
	const chunkScriptSlug = `import.e2e-partial-result-cancellation-chunk-${suffix}`;
	const detailsScriptSlug = `${providerSlug}.details`;
	const resolveScriptSlug = `${providerSlug}.resolve`;
	const workflowEntry = `backend/scripts/${workflowSlug}.sandbox.ts`;
	const chunkEntry = `backend/scripts/${chunkScriptSlug}.sandbox.ts`;
	const detailsEntry = `backend/providers/${providerSlug}/details.sandbox.ts`;
	const resolveEntry = `backend/providers/${providerSlug}/resolve.sandbox.ts`;
	const namePrefix = `E2E partial cancellation ${suffix}`;
	const committedNames = Array.from(
		{ length: PARTIAL_RESULT_COMMITTED_ITEM_COUNT },
		(_, index) => `${namePrefix} committed ${String(index + 1).padStart(2, "0")}`,
	);
	const blockedName = `${namePrefix} blocked`;
	const laterName = `${namePrefix} later`;
	const directItem = (name: string, itemIndex: number): GenericImportWriteItem => ({
		itemIndex,
		events: [],
		relationships: [],
		sourceLabel: name,
		recordId: String(itemIndex),
		subjectEntityAlias: "record",
		sourceIdentifier: String(itemIndex),
		entities: [
			{
				name,
				properties: {},
				alias: "record",
				entitySchemaSlug,
				operationId: `entity-${itemIndex}`,
				outcome: { unit: "records", recordKind: "record" },
			},
		],
	});
	const items: GenericImportWriteItem[] = [
		...committedNames.map(directItem),
		{
			...directItem(blockedName, PARTIAL_RESULT_COMMITTED_ITEM_COUNT),
			entities: [
				{
					properties: {},
					alias: "record",
					entitySchemaSlug,
					name: blockedName,
					outcome: { unit: "records", recordKind: "record" },
					operationId: `entity-${PARTIAL_RESULT_COMMITTED_ITEM_COUNT}`,
					providerResolution: { providerSlug, value: "blocked", identifierType: "source-id" },
				},
			],
		},
		directItem(laterName, PARTIAL_RESULT_COMMITTED_ITEM_COUNT + 1),
	];
	const detailsSource = providerSandboxSource({
		delayMs: 120_000,
		operation: "details",
		slug: detailsScriptSlug,
		result: { properties: {}, name: blockedName },
		name: "E2E partial-result cancellation provider details",
	});
	const resolveSource = providerSandboxSource({
		operation: "resolve",
		slug: resolveScriptSlug,
		result: { externalId: `blocked-${suffix}` },
		name: "E2E partial-result cancellation provider resolve",
	});

	return installTestPluginBundle({
		scope: "system",
		workflows: [{ slug: workflowSlug, scriptSlug: workflowScriptSlug }],
		entitySchemas: [
			{
				icon: "file",
				eventSchemas: [],
				slug: entitySchemaSlug,
				name: "E2E partial-result cancellation record",
				propertiesSchema: { fields: {}, unknownKeys: "strict" },
			},
		],
		importSources: [
			{
				slug: source,
				workflowSlug,
				name: "E2E partial-result cancellation import",
				inputSchema: { fields: {}, unknownKeys: "strict" },
				description: "Block after a durable generic-import progress checkpoint",
			},
		],
		files: {
			[detailsEntry]: detailsSource,
			[resolveEntry]: resolveSource,
			[chunkEntry]: partialResultCancellationChunkSource(chunkScriptSlug, items),
			[workflowEntry]: partialResultCancellationWorkflowSource(workflowScriptSlug, chunkScriptSlug),
		},
		providers: [
			{
				slug: providerSlug,
				information: { source: "e2e" },
				rootEntitySchemaSlug: entitySchemaSlug,
				name: "E2E partial-result cancellation provider",
				operations: { details: detailsScriptSlug, resolve: resolveScriptSlug },
			},
		],
		scripts: [
			{
				kind: "workflow",
				capabilities: [],
				entry: workflowEntry,
				slug: workflowScriptSlug,
				requiredPluginConfigKeys: [],
				name: "E2E partial-result cancellation import",
			},
			{
				kind: "script",
				entry: chunkEntry,
				slug: chunkScriptSlug,
				capabilities: ["scratch"],
				requiredPluginConfigKeys: [],
				name: "E2E partial-result cancellation chunk",
			},
			{
				providerSlug,
				kind: "provider",
				capabilities: [],
				entry: detailsEntry,
				slug: detailsScriptSlug,
				providerOperation: "details",
				requiredPluginConfigKeys: [],
				name: "E2E partial-result cancellation provider details",
			},
			{
				providerSlug,
				kind: "provider",
				capabilities: [],
				entry: resolveEntry,
				slug: resolveScriptSlug,
				providerOperation: "resolve",
				requiredPluginConfigKeys: [],
				name: "E2E partial-result cancellation provider resolve",
			},
		],
	}).pipe(
		Effect.map((plugin) => ({
			plugin,
			source,
			laterName,
			blockedName,
			committedNames,
			entitySchemaSlug,
		})),
	);
});

const testImportPinningWorkflowSource = (scriptSlug: string) => `
import {
  genericImportSealReference,
  genericImportWorkflowInputSchema,
  genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { Effect, defineManifest, defineWorkflow } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  name: "E2E import pinning",
  slug: ${JSON.stringify(scriptSlug)},
});

export default defineWorkflow({
  manifest,
  input: genericImportWorkflowInputSchema,
  output: genericImportWorkflowResultSchema,
  run: (input, replay) =>
    Effect.gen(function* () {
      yield* replay.sleep("hold-plugin-pin", 30_000);
       const sealed = yield* replay.child("complete-import", genericImportSealReference, {
         operation: { action: "seal" },
         runId: input.runId,
         command: input.command,
       });
       return { summary: sealed.summary, issues: [] };
    }),
});
`;

export const installTestImportPinningPlugin = Effect.suspend(() => {
	const suffix = crypto.randomUUID();
	const source = `e2e_pinned_import_${suffix.replaceAll("-", "_")}`;
	const workflowSlug = `pinning-import-${suffix}`;
	const scriptSlug = `workflow.e2e-pinning-import-${suffix}`;
	const entry = `backend/scripts/${workflowSlug}.sandbox.ts`;

	return installTestPluginBundle({
		scope: "system",
		workflows: [{ scriptSlug, slug: workflowSlug }],
		files: { [entry]: testImportPinningWorkflowSource(scriptSlug) },
		importSources: [
			{
				slug: source,
				workflowSlug,
				name: "E2E import pinning",
				inputSchema: { fields: {}, unknownKeys: "strict" },
				description: "Hold an accepted import open for plugin pinning coverage",
			},
		],
		scripts: [
			{
				entry,
				slug: scriptSlug,
				kind: "workflow",
				capabilities: [],
				oauthConnectionFields: [],
				name: "E2E import pinning",
				executableDependencies: [],
				requiredPluginConfigKeys: [],
				optionalPluginConfigKeys: [],
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
				c.uploads.createIntent({ payload: { fileName, kind: "temporary", contentType: mimeType } }),
			headers,
		);

		const uploadResponse = yield* webRequest(new URL(intent.uploadUrl, `${getApiUrl()}/`), {
			body: content,
			method: intent.method,
			headers: intent.headers,
		});
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
) => executeRyotQLRecipe(client, integrationImportRunsRecipe({ after, limit, integrationId }));

export const getImportRun = (
	client: Client,
	runId: string,
	issueAfter: string | undefined,
	issueLimit: number,
) =>
	Effect.gen(function* () {
		const detail = yield* executeRyotQLRecipe(client, importRunRecipe({ runId }));
		const issues = yield* executeRyotQLRecipe(
			client,
			importIssuesRecipe({ runId, after: issueAfter, limit: issueLimit }),
		);
		return { ...detail, issues };
	});

const importedEntity = table("entity", "importedEntity");
const importedEntityNamesRecipe = defineRecipe((entitySchemaSlug: string) => ({
	map: ({ entities }) => Result.succeed(entities),
	queries: {
		entities: selectedRows(importedEntity, {
			limit: 100,
			orderBy: [ascending(column(importedEntity, "name"))],
			where: eq(column(importedEntity, "entitySchemaSlug"), literal(entitySchemaSlug)),
			selection: { name: selectedField(column(importedEntity, "name"), Schema.String) },
		}),
	},
}));

export const listImportedEntityNames = (client: Client, entitySchemaSlug: string) =>
	executeRyotQLRecipe(client, importedEntityNamesRecipe(entitySchemaSlug)).pipe(
		Effect.map(({ items }) => items.map(({ name }) => name)),
	);

export const pollImportRunUntilTerminal = (client: Client, runId: string) =>
	pollUntil(
		`Import run '${runId}' to become terminal`,
		Effect.gen(function* () {
			const detail = yield* getImportRun(client, runId, undefined, 100);
			const run = requirePresent(detail.run, `Import run '${runId}' not found`);
			if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
				return run;
			}
			return null;
		}),
	);
