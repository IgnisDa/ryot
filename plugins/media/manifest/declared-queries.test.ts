import { expect, it } from "bun:test";

import { fitnessPlugin } from "@ryot-app/fitness-plugin";
import { fixturePlugin } from "@ryot-app/fixture-plugin";
import { kernelDefinitionSource } from "@ryot-app/kernel-backend/modules/definitions/kernel-source";
import { validateSystemPluginSet } from "@ryot-app/kernel-backend/modules/plugins/packages/system-set";

import { mediaPlugin } from "./plugin";

it("accepts every declared Media and Fitness query through complete system ingestion", () => {
	expect(Object.keys(mediaPlugin.queries)).toHaveLength(8);
	expect(Object.keys(fitnessPlugin.queries)).toHaveLength(8);
	const plugins = [
		{ id: "media-owner", scope: "system" as const, manifest: { ...mediaPlugin, scripts: [] } },
		{ id: "fitness-owner", scope: "system" as const, manifest: { ...fitnessPlugin, scripts: [] } },
		{ id: "fixture-owner", scope: "system" as const, manifest: { ...fixturePlugin, scripts: [] } },
	];
	expect(() => validateSystemPluginSet(kernelDefinitionSource(), plugins)).not.toThrow();
});
