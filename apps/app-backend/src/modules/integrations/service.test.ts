import { describe, expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";

import { dbRunnerLayer, makeWorkflowEngine, transactionLayer } from "#lib/test-utils/effect";
import { ImportsService } from "#modules/imports/service";
import {
	IntegrationProviderCatalog,
	type RegisteredIntegrationProvider,
} from "#modules/plugins/integration-provider-catalog";

import { IntegrationsRepository } from "./repository";
import { IntegrationsService, resolveIntegrationLot, validateProgressThresholds } from "./service";
import { makeIntegration } from "./test-support";

describe("resolveIntegrationLot", () => {
	const registered = {
		lot: "sink",
		name: "Test provider",
		slug: "test-provider",
		pluginSlug: "media",
		scriptSlug: "integration.test-provider",
		description: "Test sink",
		settingsSchema: { fields: {} },
	} satisfies RegisteredIntegrationProvider;

	it("prefers the registry lot over the hardcoded table", () => {
		expect(resolveIntegrationLot(() => registered, "test-provider")).toBe("sink");
	});

	it("returns null when the registry does not know the provider", () => {
		expect(resolveIntegrationLot(() => null, "test-provider")).toBeNull();
	});
});

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
			_tag: "IntegrationsRepository",
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
			_tag: "IntegrationProviderCatalog",
			find: () => registered,
			list: () => [registered],
		});
		const layer = IntegrationsService.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					dbRunnerLayer,
					transactionLayer,
					repository,
					providerCatalog,
					Layer.mock(ImportsService, { _tag: "ImportsService" }),
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
});
