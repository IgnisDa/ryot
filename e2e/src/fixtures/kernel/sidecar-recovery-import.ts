import { PluginSlug } from "@ryot-app/contract/schema/brands";
import type { GenericImportWriteItem } from "@ryot-app/sandbox-sdk/imports";
import { Effect, Schema } from "effect";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getApiClient } from "./contract-client";
import { providerSandboxSource } from "./sandbox-provider";
import {
	installTestPluginBundle,
	installTestSupportSystemPlugin,
	testPluginManifest,
} from "./test-plugin";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export const installSidecarRecoveryImport = (client: Client, checkpointUrl: string) =>
	Effect.gen(function* () {
		const suffix = crypto.randomUUID();
		const entitySchemaSlug = `sidecar-recovery-${suffix}`;
		const providerSlug = `${entitySchemaSlug}.provider`;
		const detailsSlug = `${providerSlug}.details`;
		const resolveSlug = `${providerSlug}.resolve`;
		const workflowSlug = `recovery-${suffix}`;
		const workflowScriptSlug = `workflow.${workflowSlug}`;
		const chunkSlug = `chunk.${workflowSlug}`;
		const source = `sidecar_recovery_${suffix.replaceAll("-", "_")}`;
		const committedName = `Committed ${suffix}`;
		const recoveredName = `Recovered ${suffix}`;
		const checkpoint = `native-recovery-provider-${suffix}`;
		const item = (name: string, index: number): GenericImportWriteItem => ({
			events: [],
			itemIndex: index,
			relationships: [],
			sourceLabel: name,
			recordId: String(index),
			subjectEntityAlias: "record",
			sourceIdentifier: String(index),
			entities: [
				{
					name,
					properties: {},
					alias: "record",
					entitySchemaSlug,
					operationId: `entity-${index}`,
					outcome: { unit: "records", recordKind: "record" },
					...(index === 1
						? { providerResolution: { providerSlug, value: suffix, identifierType: "source-id" } }
						: {}),
				},
			],
		});
		const chunks = [committedName, recoveredName].map((name, index) => ({
			name: `chunk-${index}.json`,
			contents: encodeJson({ failures: [], items: [item(name, index)] }),
		}));
		const workflowEntry = "backend/scripts/import.sandbox.ts";
		const chunkEntry = "backend/scripts/chunks.sandbox.ts";
		const detailsEntry = `backend/providers/${providerSlug}/details.sandbox.ts`;
		const resolveEntry = `backend/providers/${providerSlug}/resolve.sandbox.ts`;
		const policyManifest = testPluginManifest({
			pluginSlug: `sidecar-recovery-policy-${suffix}`,
			httpRateLimits: [
				{
					requests: 1,
					intervalMs: 100,
					key: `sidecar.recovery.${suffix}`,
					origins: [new URL(checkpointUrl).origin],
				},
			],
		});
		yield* Effect.acquireRelease(
			installTestSupportSystemPlugin({ files: {}, manifest: policyManifest }),
			({ activationId }) =>
				getApiClient()
					.call(
						(c) =>
							c.testSupport.uninstallSystemPlugin({
								params: { activationId, pluginSlug: PluginSlug.make(policyManifest.metadata.slug) },
							}),
						adminHeaders(),
					)
					.pipe(Effect.orDie),
		);
		const plugin = yield* installTestPluginBundle({
			client,
			scope: "user",
			pluginSlug: `sidecar-recovery-import-${suffix}`,
			workflows: [{ slug: workflowSlug, scriptSlug: workflowScriptSlug }],
			entitySchemas: [
				{
					icon: "file",
					eventSchemas: [],
					slug: entitySchemaSlug,
					name: "Sidecar recovery record",
					propertiesSchema: { fields: {}, unknownKeys: "strict" },
				},
			],
			providers: [
				{
					slug: providerSlug,
					information: { source: "e2e" },
					name: "Sidecar recovery provider",
					rootEntitySchemaSlug: entitySchemaSlug,
					operations: { details: detailsSlug, resolve: resolveSlug },
				},
			],
			importSources: [
				{
					slug: source,
					workflowSlug,
					name: "Sidecar recovery import",
					inputSchema: { fields: {}, unknownKeys: "strict" },
					description: "Import with a provider checkpoint after a committed batch",
				},
			],
			scripts: [
				{
					kind: "workflow",
					capabilities: [],
					entry: workflowEntry,
					slug: workflowScriptSlug,
					requiredPluginConfigKeys: [],
					name: "Sidecar recovery import",
				},
				{
					kind: "script",
					slug: chunkSlug,
					entry: chunkEntry,
					capabilities: ["scratch"],
					requiredPluginConfigKeys: [],
					name: "Sidecar recovery chunks",
				},
				{
					providerSlug,
					kind: "provider",
					slug: detailsSlug,
					entry: detailsEntry,
					requiredPluginConfigKeys: [],
					providerOperation: "details",
					name: "Sidecar recovery details",
					capabilities: ["httpCall", "log"],
				},
				{
					providerSlug,
					kind: "provider",
					capabilities: [],
					slug: resolveSlug,
					entry: resolveEntry,
					requiredPluginConfigKeys: [],
					providerOperation: "resolve",
					name: "Sidecar recovery resolve",
				},
			],
			files: {
				[resolveEntry]: providerSandboxSource({
					slug: resolveSlug,
					operation: "resolve",
					result: { externalId: suffix },
					name: "Sidecar recovery resolve",
				}),
				[chunkEntry]: `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Schema } from "@ryot-app/sandbox-sdk/effect";
import { sandboxScratchManifestSchema, writeScratchChunks } from "@ryot-app/sandbox-sdk/filesystem";
export const manifest = defineManifest({ kind: "script", name: "Sidecar recovery chunks", slug: ${encodeJson(chunkSlug)} });
export default defineScript({ manifest, input: Schema.Struct({}), output: sandboxScratchManifestSchema,
  run: () => writeScratchChunks(${encodeJson(chunks)}),
});`,
				[detailsEntry]: `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";
export const manifest = defineManifest({ kind: "provider", name: "Sidecar recovery details", slug: ${encodeJson(detailsSlug)} });
export default defineProvider({ manifest, operation: "details",
  run: (input, host, execution) => Effect.gen(function* () {
    yield* host.httpCall("POST", ${encodeJson(`${checkpointUrl}/enter`)}, { body: JSON.stringify({ input, startedAt: execution.startedAt, scriptId: execution.sandboxScriptId }), headers: { "content-type": "application/json" } });
    yield* host.log([{ level: "info", message: ${encodeJson(checkpoint)} }]);
    yield* Effect.sleep("20 seconds");
    return { name: ${encodeJson(recoveredName)}, properties: {} };
  }),
});`,
				[workflowEntry]: `
import {
  genericImportApplyReference, genericImportCaptureReference, genericImportSealReference,
  genericImportWorkflowInputSchema, genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { defineManifest, defineScriptReference, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";
export const manifest = defineManifest({ kind: "workflow", name: "Sidecar recovery import", slug: ${encodeJson(workflowScriptSlug)} });
const chunks = defineScriptReference({ scriptSlug: ${encodeJson(chunkSlug)}, input: Schema.Struct({}), output: Schema.Struct({ chunkHandles: Schema.Array(Schema.String) }) });
export default defineWorkflow({ manifest, input: genericImportWorkflowInputSchema, output: genericImportWorkflowResultSchema,
  run: (input, replay) => Effect.gen(function* () {
    const written = yield* replay.activity("chunks", chunks, {});
    const attribution = { runId: input.runId, command: input.command };
    for (const [ordinal, handle] of written.chunkHandles.entries()) {
      const captured = yield* replay.child("capture-" + ordinal, genericImportCaptureReference, {
        ...attribution, operation: { action: "capture", phase: "application", ordinal, handle, captureId: "chunk-" + ordinal, checkpoint: {} },
      });
      yield* replay.child("apply-" + ordinal, genericImportApplyReference, {
        ...attribution, operation: { action: "apply", ordinal, batchId: "batch-" + ordinal, captureId: captured.captureId, inputFingerprint: captured.inputFingerprint },
      });
    }
    const sealed = yield* replay.child("seal", genericImportSealReference, { ...attribution, operation: { action: "seal" } });
    return { summary: sealed.summary, issues: [] };
  }),
});`,
			},
		});
		return {
			plugin,
			source,
			suffix,
			checkpoint,
			detailsSlug,
			resolveSlug,
			committedName,
			recoveredName,
			entitySchemaSlug,
		};
	});
