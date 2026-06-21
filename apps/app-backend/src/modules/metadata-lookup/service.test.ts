import { expect, it } from "@effect/vitest";
import { BadRequest, NotFound, SandboxRunError } from "@ryot/contract/errors";
import {
	EntitySchemaId,
	IntegrationId,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import type { Exit } from "effect";
import { Cause, Effect, Layer, Option } from "effect";
import { assert } from "vitest";

import { SandboxService } from "#lib/sandbox/service";
import { type MockOverrides, dbRunnerLayer } from "#lib/test-support/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { makeIntegration } from "#modules/integrations/test-support";
import { SandboxRepository } from "#modules/sandbox/repository";

import { MetadataLookupService } from "./service";

const movieScriptId = SandboxScriptId.make("script-movie");
const showScriptId = SandboxScriptId.make("script-show");
const integrationId = IntegrationId.make("int_1");

const browserExtensionIntegration = makeIntegration({
	provider: "ryot_browser_extension",
	providerSpecifics: { kind: "ryot_browser_extension" },
});

const mockSandbox = Layer.mock(SandboxService);
const mockSandboxRepository = Layer.mock(SandboxRepository);
const mockEntitiesRepository = Layer.mock(EntitiesRepository);
const mockIntegrationsRepository = Layer.mock(IntegrationsRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({
		findEntitySchemaSandboxScriptBySlug: (slug) => {
			if (slug === "movie.tmdb") {
				return Effect.succeed({
					sandboxScriptId: movieScriptId,
					entitySchemaId: EntitySchemaId.make("movie-schema"),
				});
			}
			if (slug === "show.tmdb") {
				return Effect.succeed({
					sandboxScriptId: showScriptId,
					entitySchemaId: EntitySchemaId.make("show-schema"),
				});
			}
			return Effect.succeed(null);
		},
		...overrides,
		_tag: "EntitiesRepository",
	});

const makeIntegrationsRepository = (
	overrides: MockOverrides<typeof mockIntegrationsRepository> = {},
) =>
	mockIntegrationsRepository({
		getByIdAnyUser: () => Effect.succeed(browserExtensionIntegration),
		...overrides,
		_tag: "IntegrationsRepository",
	});

const makeSandboxRepository = (overrides: MockOverrides<typeof mockSandboxRepository> = {}) =>
	mockSandboxRepository({
		getScriptForUser: ({ scriptId }) =>
			Effect.succeed({
				scriptId,
				code: "// tmdb",
				id: scriptId,
				userId: null,
				isBuiltin: true,
				metadata: { allowedHostFunctions: [] },
			}),
		...overrides,
		_tag: "SandboxRepository",
	});

const searchItem = (input: { externalId: string; title: string; publishYear?: number }) => ({
	externalId: input.externalId,
	titleProperty: { kind: "text" as const, value: input.title },
	primarySubtitleProperty:
		input.publishYear === undefined
			? { kind: "null" as const, value: null }
			: { kind: "number" as const, value: input.publishYear },
});

const makeSandbox = (overrides: MockOverrides<typeof mockSandbox> = {}) =>
	mockSandbox({
		run: (input) =>
			Effect.succeed({
				logs: [],
				error: null,
				success: true,
				value: {
					items:
						input.scriptId === movieScriptId
							? [searchItem({ title: "The Crown", externalId: "movie_1", publishYear: 2016 })]
							: [searchItem({ title: "The Crown", externalId: "show_1", publishYear: 2016 })],
				},
				executionId: input.executionId,
				timing: { totalMs: 1, executionMs: 1 },
			}),
		...overrides,
		_tag: "SandboxService",
	});

const makeServiceLayer = (
	options: {
		sandbox?: Layer.Layer<SandboxService>;
		sandboxRepository?: Layer.Layer<SandboxRepository>;
		entitiesRepository?: Layer.Layer<EntitiesRepository>;
		integrationsRepository?: Layer.Layer<IntegrationsRepository>;
	} = {},
) =>
	MetadataLookupService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				options.sandbox ?? makeSandbox(),
				options.sandboxRepository ?? makeSandboxRepository(),
				options.entitiesRepository ?? makeEntitiesRepository(),
				options.integrationsRepository ?? makeIntegrationsRepository(),
			),
		),
	);

const failure = <A, E>(exit: Exit.Exit<A, E>) => {
	expect(exit._tag).toBe("Failure");
	assert(exit._tag === "Failure", "Expected effect to fail");
	const maybeFailure = Cause.failureOption(exit.cause);
	expect(Option.isSome(maybeFailure)).toBe(true);
	return Option.getOrNull(maybeFailure);
};

it.effect("returns the best TMDB match with show episode information", () =>
	Effect.gen(function* () {
		const service = yield* MetadataLookupService;

		const result = yield* service.lookup(integrationId, {
			title: "The Crown: Season 1: Episode 2",
		});

		expect(result).toEqual({
			title: "The Crown",
			status: "found",
			data: { lot: "show", source: "tmdb", identifier: "show_1" },
			showInformation: { season: 1, episode: 2 },
		});
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("returns notFound when TMDB search has no usable match", () =>
	Effect.gen(function* () {
		const service = yield* MetadataLookupService;
		const result = yield* service.lookup(integrationId, { title: "Unknown Title" });

		expect(result).toEqual({ notFound: true, status: "notFound" });
	}).pipe(
		Effect.provide(
			makeServiceLayer({
				sandbox: makeSandbox({
					run: (input) =>
						Effect.succeed({
							logs: [],
							error: null,
							value: { items: [] },
							success: true,
							executionId: input.executionId,
							timing: { totalMs: 1, executionMs: 1 },
						}),
				}),
			}),
		),
	),
);

it.effect("rejects an empty title", () =>
	Effect.gen(function* () {
		const service = yield* MetadataLookupService;
		const exit = yield* Effect.exit(service.lookup(integrationId, { title: "   " }));

		expect(failure(exit)).toBeInstanceOf(BadRequest);
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("rejects non-browser-extension integrations", () =>
	Effect.gen(function* () {
		const service = yield* MetadataLookupService;
		const exit = yield* Effect.exit(service.lookup(integrationId, { title: "The Crown" }));

		expect(failure(exit)).toBeInstanceOf(BadRequest);
	}).pipe(
		Effect.provide(
			makeServiceLayer({
				integrationsRepository: makeIntegrationsRepository({
					getByIdAnyUser: () => Effect.succeed(makeIntegration()),
				}),
			}),
		),
	),
);

it.effect("returns NotFound for a disabled integration", () =>
	Effect.gen(function* () {
		const service = yield* MetadataLookupService;
		const exit = yield* Effect.exit(service.lookup(integrationId, { title: "The Crown" }));

		expect(failure(exit)).toBeInstanceOf(NotFound);
	}).pipe(
		Effect.provide(
			makeServiceLayer({
				integrationsRepository: makeIntegrationsRepository({
					getByIdAnyUser: () =>
						Effect.succeed(makeIntegration({ isDisabled: true, userId: UserId.make("user_1") })),
				}),
			}),
		),
	),
);

it.effect("returns NotFound for a missing integration", () =>
	Effect.gen(function* () {
		const service = yield* MetadataLookupService;
		const exit = yield* Effect.exit(service.lookup(integrationId, { title: "The Crown" }));

		expect(failure(exit)).toBeInstanceOf(NotFound);
	}).pipe(
		Effect.provide(
			makeServiceLayer({
				integrationsRepository: makeIntegrationsRepository({
					getByIdAnyUser: () => Effect.succeed(null),
				}),
			}),
		),
	),
);

it.effect("returns NotFound when TMDB scripts are missing", () =>
	Effect.gen(function* () {
		const service = yield* MetadataLookupService;
		const exit = yield* Effect.exit(service.lookup(integrationId, { title: "The Crown" }));

		expect(failure(exit)).toBeInstanceOf(NotFound);
	}).pipe(
		Effect.provide(
			makeServiceLayer({
				entitiesRepository: makeEntitiesRepository({
					findEntitySchemaSandboxScriptBySlug: () => Effect.succeed(null),
				}),
			}),
		),
	),
);

it.effect("returns SandboxRunError when sandbox search fails", () =>
	Effect.gen(function* () {
		const service = yield* MetadataLookupService;
		const exit = yield* Effect.exit(service.lookup(integrationId, { title: "The Crown" }));

		expect(failure(exit)).toBeInstanceOf(SandboxRunError);
	}).pipe(
		Effect.provide(
			makeServiceLayer({
				sandbox: makeSandbox({
					run: (input) =>
						Effect.succeed({
							logs: [],
							value: null,
							success: false,
							error: "TMDB failed",
							executionId: input.executionId,
							timing: { totalMs: 1, executionMs: 1 },
						}),
				}),
			}),
		),
	),
);
