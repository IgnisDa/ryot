import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { dbRunnerLayer, makeWorkflowEngine, transactionLayer } from "#lib/test-utils/effect";
import { ImportsService } from "#modules/imports/service";
import {
	IntegrationProviderCatalog,
	type RegisteredIntegrationProvider,
} from "#modules/plugins/integration-provider-catalog";

import { IntegrationsRepository } from "./repository";
import { IntegrationsService, validateProgressThresholds } from "./service";
import { makeIntegration } from "./test-support";

describe("validateProgressThresholds", () => {
	it("returns null for valid thresholds", () => {
		expect(validateProgressThresholds(2, 95)).toBeNull();
		expect(validateProgressThresholds(0, 100)).toBeNull();
		expect(validateProgressThresholds(50, 50)).toBeNull();
	});

	it("rejects minimumProgress below 0", () => {
		expect(validateProgressThresholds(-1, 95)).toMatch(/minimumProgress/);
	});

	it("rejects minimumProgress above 100", () => {
		expect(validateProgressThresholds(101, 101)).toMatch(/minimumProgress/);
	});

	it("rejects maximumProgress above 100", () => {
		expect(validateProgressThresholds(2, 101)).toMatch(/maximumProgress/);
	});

	it("rejects minimum greater than maximum", () => {
		expect(validateProgressThresholds(96, 95)).toMatch(/minimumProgress must not exceed/);
	});
});

describe("update", () => {
	it.effect("preserves a stored secret omitted from a provider settings update", () => {
		const registered = {
			lot: "yank",
			name: "Audiobookshelf",
			pluginSlug: "media",
			slug: "audiobookshelf",
			description: "Test yank",
			scriptSlug: "integration.audiobookshelf",
			settingsSchema: {
				fields: {
					kind: {
						type: "enum",
						label: "Provider kind",
						options: ["audiobookshelf"],
						description: "Integration provider discriminator",
						validation: { required: true },
					},
					baseUrl: {
						type: "string",
						label: "Base URL",
						description: "Audiobookshelf instance URL",
						validation: { required: true },
					},
					token: {
						type: "string",
						secret: true,
						label: "Token",
						description: "Audiobookshelf access token",
						validation: { required: true },
					},
				},
			},
		} satisfies RegisteredIntegrationProvider;
		let state = makeIntegration({
			lot: "yank",
			provider: "audiobookshelf",
			providerSpecifics: {
				token: "stored-token",
				kind: "audiobookshelf",
				baseUrl: "https://old.example.com",
			},
		});
		const repository = Layer.mock(IntegrationsRepository)({
			getForUser: () => Effect.succeed(state),
			updateForUser: (input) => {
				state = {
					...state,
					providerSpecifics: input.providerSpecifics ?? state.providerSpecifics,
				};
				return Effect.succeed(state);
			},
		});
		const providerCatalog = Layer.mock(IntegrationProviderCatalog)({
			find: () => registered,
			list: () => [registered],
			findOwned: () => registered,
			resolveOwned: () => ({ provider: registered, script: Effect.succeed(null) }),
		});
		const layer = IntegrationsService.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					dbRunnerLayer,
					transactionLayer,
					repository,
					providerCatalog,
					Layer.mock(ImportsService, {}),
					Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				),
			),
		);

		return Effect.gen(function* () {
			const service = yield* IntegrationsService;
			const updated = yield* service.update(state.userId, state.id, {
				providerSpecifics: {
					kind: "audiobookshelf",
					baseUrl: "https://new.example.com",
				},
			});

			expect(updated.providerSpecifics).toEqual({
				token: "stored-token",
				kind: "audiobookshelf",
				baseUrl: "https://new.example.com",
			});
			expect(state.providerSpecifics).toEqual(updated.providerSpecifics);
		}).pipe(Effect.provide(layer));
	});

	it.effect("does not expose stored settings to a replacement provider owner", () => {
		const existing = makeIntegration({
			provider: "shared-provider",
			pluginSlug: "original-owner",
			providerSpecifics: { token: "stored-token" },
		});
		let updated = false;
		const replacement = {
			lot: "yank",
			name: "Replacement",
			slug: "shared-provider",
			settingsSchema: { fields: {} },
			pluginSlug: "replacement-owner",
			description: "Replacement provider",
			scriptSlug: "replacement.integration",
		} satisfies RegisteredIntegrationProvider;
		const repository = Layer.mock(IntegrationsRepository)({
			getForUser: () => Effect.succeed(existing),
			updateForUser: () => {
				updated = true;
				return Effect.succeed(existing);
			},
		});
		const providerCatalog = Layer.mock(IntegrationProviderCatalog)({
			findOwned: () => null,
			find: () => replacement,
			resolveOwned: () => null,
			list: () => [replacement],
		});
		const layer = IntegrationsService.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					dbRunnerLayer,
					transactionLayer,
					repository,
					providerCatalog,
					Layer.mock(ImportsService, {}),
					Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				),
			),
		);

		return Effect.gen(function* () {
			const service = yield* IntegrationsService;
			const error = yield* Effect.flip(
				service.update(existing.userId, existing.id, {
					providerSpecifics: { token: "replacement-token" },
				}),
			);

			expect(error.message).toBe("Integration provider 'shared-provider' is not registered");
			expect(updated).toBe(false);
		}).pipe(Effect.provide(layer));
	});
});
