import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { fixtureManifest } from "./test-support";
import { validateIntegrationProviderSettingsSchemas } from "./validation";

it.effect("rejects an integration provider whose settingsSchema declares no properties", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		const error = yield* Effect.flip(
			validateIntegrationProviderSettingsSchemas({
				...manifest,
				integrationProviders: [
					{
						lot: "yank",
						slug: "plex",
						name: "Plex",
						description: "Plex yank",
						settingsSchema: { fields: {} },
						scriptSlug: "fixture.automation",
					},
				],
			}),
		);

		expect(error.issues.join("; ")).toMatch(/Integration provider plex in plugin fixture/);
	}),
);
