import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { assert } from "vitest";

import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { fixtureManifest } from "./test-support";
import {
	validateIntegrationProviderSettingsSchemas,
	validatePluginManifestReferences,
} from "./validation";

it.effect("rejects an integration provider whose settingsSchema declares no properties", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		const error = yield* Effect.flip(
			validateIntegrationProviderSettingsSchemas({
				...manifest,
				integrationProviders: [
					{
						lot: "yank",
						slug: "lambda",
						name: "Lambda",
						description: "Lambda yank",
						settingsSchema: { fields: {} },
						scriptSlug: "fixture.automation",
					},
				],
			}),
		);

		expect(error.issues.join("; ")).toMatch(/Integration provider lambda in plugin fixture/);
	}),
);

it.effect("rejects an integration provider settings field that shadows a common one", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		const error = yield* Effect.flip(
			validateIntegrationProviderSettingsSchemas({
				...manifest,
				integrationProviders: [
					{
						lot: "yank",
						slug: "lambda",
						name: "Lambda",
						description: "Lambda yank",
						scriptSlug: "fixture.automation",
						settingsSchema: {
							fields: {
								isDisabled: { type: "boolean", label: "Disabled", description: "Disabled" },
							},
						},
					},
				],
			}),
		);

		expect(error.issues.join("; ")).toMatch(/declares reserved settings field: isDisabled/);
	}),
);

it.effect("rejects a non-push integration provider bound to a non-script kind", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		const script = manifest.scripts[0];
		assert(script);
		const withProvider = (scriptSlug: string) => ({
			...manifest,
			bindings: { ...manifest.bindings, entityAutomations: [] },
			scripts: [
				...manifest.scripts,
				{ ...script, name: "Sink", kind: "script" as const, slug: "integration.sink" },
			],
			integrationProviders: [
				{
					scriptSlug,
					slug: "lambda_sink",
					name: "Lambda sink",
					lot: "sink" as const,
					description: "Lambda sink",
					settingsSchema: {
						fields: { username: { label: "User", description: "User", type: "string" as const } },
					},
				},
			],
		});
		const snapshot = makeDefinitionRegistry().getSnapshot();

		const error = yield* Effect.flip(
			validatePluginManifestReferences(withProvider("fixture.automation"), snapshot),
		);
		expect(error.issues.join("; ")).toContain(
			"Integration provider lambda_sink script fixture.automation must be a direct script",
		);
		yield* validatePluginManifestReferences(withProvider("integration.sink"), snapshot);
	}),
);
