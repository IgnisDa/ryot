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
	const workflowEntry = `backend/scripts/workflow.integration-${suffix}.sandbox.ts`;
	const workflowScriptSlug = `workflow.e2e-integration-${suffix}`;
	const name = "E2E integration sink";
	const source = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  capabilities: [],
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
  genericImportSealReference,
  genericImportWorkflowInputSchema,
  genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { defineExecutableAlternatives, defineManifest, defineScriptReference, defineWorkflow, Effect, Schema, selectExecutable } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  capabilities: [],
  name: "E2E integration ingestion",
  slug: ${JSON.stringify(workflowScriptSlug)},
});

const adapters = defineExecutableAlternatives({
  id: "integration-adapter",
  stage: "settings",
  references: {
    ${JSON.stringify(scriptSlug)}: defineScriptReference({ scriptSlug: ${JSON.stringify(scriptSlug)}, input: Schema.Unknown, output: Schema.Unknown }),
  },
});

export default defineWorkflow({
  manifest,
  input: genericImportWorkflowInputSchema,
  output: genericImportWorkflowResultSchema,
  run: (input, replay) =>
    Effect.gen(function* () {
      const integrationScriptSlug = input.plan.selection["integration-adapter"];
      if (typeof integrationScriptSlug !== "string") throw new Error("Missing integration adapter selection");
      yield* replay.activity(
        "read-integration",
        selectExecutable(adapters, integrationScriptSlug),
        {},
      );
      const sealed = yield* replay.child("seal", genericImportSealReference, {
        runId: input.runId,
        command: input.command,
        operation: { action: "seal" },
      });
      return { issues: [], summary: sealed.summary };
    }),
});
`;

	return installTestPluginBundle({
		pluginSlug,
		scope: "system",
		baseUrl: options.baseUrl,
		files: { [entry]: source, [workflowEntry]: workflowSource },
		workflows: [{ slug: "integration", scriptSlug: workflowScriptSlug }],
		scripts: [
			{
				name,
				entry,
				kind: "script",
				slug: scriptSlug,
				capabilities: [],
				requiredPluginConfigKeys: [],
			},
			{
				kind: "workflow",
				capabilities: [],
				entry: workflowEntry,
				slug: workflowScriptSlug,
				requiredPluginConfigKeys: [],
				name: "E2E integration ingestion",
			},
		],
		integrationProviders: [
			{
				lot: "sink",
				settingsSchema,
				slug: providerSlug,
				scriptSlug: workflowScriptSlug,
				name: "E2E integration provider",
				description: "E2E dynamically installed integration provider",
				plan: { selections: { "integration-adapter": { value: scriptSlug } } },
				...(options.requiresProKey !== undefined ? { requiresProKey: options.requiresProKey } : {}),
			},
		],
	}).pipe(Effect.map((plugin) => ({ plugin, providerSlug })));
};
