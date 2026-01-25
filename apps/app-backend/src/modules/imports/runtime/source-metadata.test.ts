import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import type { RegisteredImportSource } from "#modules/plugins/import-source-catalog";

import { registryImportSourceFileInputs, registryImportSourceStartError } from "./source-metadata";

const registeredSource = (overrides: Partial<RegisteredImportSource> = {}) =>
	({
		input: "file",
		name: "Netflix",
		slug: "netflix",
		pluginSlug: "media",
		requiredAppConfigKeys: [],
		description: "Netflix export",
		workflowSlug: "netflix-import",
		allowedFileExtensions: ["zip"],
		...overrides,
	}) satisfies RegisteredImportSource;

it("maps a registry file source onto the single-artifact upload token input", () => {
	expect(
		registryImportSourceFileInputs(registeredSource(), {
			source: "netflix",
			profileName: "Kids",
			uploadToken: " tok_netflix ",
		}),
	).toEqual([
		{
			required: undefined,
			payloadKey: undefined,
			bodyField: "uploadToken",
			allowedExtensions: ["zip"],
			uploadToken: "tok_netflix",
		},
	]);
});

it("maps a registry payload source onto no file inputs", () => {
	expect(
		registryImportSourceFileInputs(registeredSource({ input: "payload", slug: "trakt" }), {
			source: "trakt",
			username: "alice",
		}),
	).toEqual([]);
});

it.effect("reports every unconfigured app config key a registry source requires", () =>
	Effect.gen(function* () {
		const config = yield* AppConfig;

		expect(
			registryImportSourceStartError(
				registeredSource({
					requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken", "books.hardcoverApiKey"],
				}),
				config,
			),
		).toBe(
			"Netflix importer is not configured. Set moviesAndShows.tmdbAccessToken, books.hardcoverApiKey.",
		);
	}).pipe(Effect.provide(makeAppConfigLayer())),
);

it.effect("accepts a registry source whose required app config keys are all set", () =>
	Effect.gen(function* () {
		const config = yield* AppConfig;

		expect(
			registryImportSourceStartError(
				registeredSource({ requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"] }),
				config,
			),
		).toBeUndefined();
	}).pipe(
		Effect.provide(
			makeAppConfigLayer({
				moviesAndShows: { tmdbAccessToken: Option.some(Redacted.make("tmdb-token")) },
			}),
		),
	),
);
