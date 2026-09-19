import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { assert } from "vitest";

import { kernelDefinitionSource } from "#modules/definition-registry/kernel-source";
import { buildDefinitionSnapshot } from "#modules/definition-registry/snapshot";

import { fixtureManifest } from "./test-support";
import {
	validateIntegrationProviderSettingsSchemas,
	validatePluginExecutableScripts,
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

it.effect("requires non-push integration providers to reference workflow scripts", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		const script = manifest.scripts[0];
		assert(script);
		const {
			automationType: _automationType,
			inputProjection: _inputProjection,
			...common
		} = script;
		const withProvider = (scriptSlug: string) => ({
			...manifest,
			hooks: [],
			signalSchemas: [],
			scripts: [
				...manifest.scripts,
				{ ...common, name: "Sink", kind: "script" as const, slug: "integration.sink" },
				{
					...common,
					name: "Workflow",
					kind: "workflow" as const,
					capabilities: [] as const,
					slug: "integration.workflow",
				},
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
		const snapshot = buildDefinitionSnapshot(kernelDefinitionSource());

		for (const slug of ["fixture.automation", "integration.sink"]) {
			const error = yield* Effect.flip(
				validatePluginManifestReferences(withProvider(slug), snapshot),
			);
			expect(error.issues.join("; ")).toContain(
				`Integration provider lambda_sink script ${slug} must be a workflow script`,
			);
		}
		const valid = withProvider("integration.workflow");
		yield* validatePluginManifestReferences(valid, snapshot);
		yield* validatePluginExecutableScripts({
			manifest: valid,
			scripts: [{ slug: "integration.workflow", metadata: { kind: "workflow" } }],
		});
		for (const scripts of [
			[],
			[{ slug: "integration.workflow", metadata: { kind: "script" as const } }],
		]) {
			const error = yield* Effect.flip(
				validatePluginExecutableScripts({ scripts, manifest: valid }),
			);
			expect(error.issues.join("; ")).toMatch(/Integration provider lambda_sink/);
		}
	}),
);
