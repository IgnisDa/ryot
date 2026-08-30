import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { Effect } from "effect";

import { installTestPluginBundle } from "./test-plugin";

export const installTestIntegrationProvider = (
	settingsSchema: PluginManifest["integrationProviders"][number]["settingsSchema"],
	options: { baseUrl?: string; delayMs?: number; requiresProKey?: boolean } = {},
) => {
	const suffix = crypto.randomUUID();
	const pluginSlug = `e2e-integration-plugin-${suffix}`;
	const providerSlug = `e2e-integration-provider-${suffix}`;
	const scriptSlug = `integration.e2e-sink-${suffix}`;
	const entry = `backend/scripts/${scriptSlug}.sandbox.ts`;
	const workflowEntry = `backend/scripts/workflow.import-${suffix}.sandbox.ts`;
	const workflowScriptSlug = `workflow.e2e-integration-import-${suffix}`;
	const name = "E2E integration sink";
	const source = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: ${JSON.stringify(name)},
  slug: ${JSON.stringify(scriptSlug)},
});

export default defineScript({
  manifest,
  input: Schema.Unknown,
  output: Schema.Unknown,
  run: () => ${options.delayMs === undefined ? "Effect.succeed(null)" : `Effect.sleep(${JSON.stringify(`${options.delayMs} millis`)}).pipe(Effect.as(null))`},
});
`;
	const workflowSource = `
import {
  genericImportKernelInputSchema,
  genericImportWorkflowInputSchema,
  genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: "E2E integration import",
  slug: ${JSON.stringify(workflowScriptSlug)},
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
      const integrationScriptSlug = input.sourcePayload?.["integrationScriptSlug"];
      if (typeof integrationScriptSlug !== "string") throw new Error("Missing integration script slug");
      yield* replay.activity(
        "read-integration",
        { scriptSlug: integrationScriptSlug, input: Schema.Unknown, output: Schema.Unknown },
        input.sourcePayload?.["integrationContext"] ?? {},
      );
      return yield* replay.child("complete-import", kernelImport, {
        totalItems: 0,
        failureCount: 0,
        chunkHandles: [],
        writeItemCount: 0,
        runId: input.runId,
        command: input.command,
      });
    }),
});
`;

	return installTestPluginBundle({
		pluginSlug,
		scope: "system",
		baseUrl: options.baseUrl,
		files: { [entry]: source, [workflowEntry]: workflowSource },
		workflows: [{ slug: "import", scriptSlug: workflowScriptSlug }],
		integrationProviders: [
			{
				scriptSlug,
				lot: "sink",
				settingsSchema,
				slug: providerSlug,
				name: "E2E integration provider",
				description: "E2E dynamically installed integration provider",
				...(options.requiresProKey !== undefined ? { requiresProKey: options.requiresProKey } : {}),
			},
		],
		scripts: [
			{
				name,
				entry,
				kind: "script",
				slug: scriptSlug,
				capabilities: [],
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
			},
			{
				kind: "workflow",
				capabilities: [],
				entry: workflowEntry,
				slug: workflowScriptSlug,
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				name: "E2E integration import",
			},
		],
	}).pipe(Effect.map((plugin) => ({ plugin, providerSlug })));
};
