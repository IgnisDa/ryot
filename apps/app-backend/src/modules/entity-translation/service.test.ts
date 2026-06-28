import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { NotFound } from "@ryot/contract/errors";
import { EntityId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer, makeWorkflowEngine } from "#lib/test-utils/effect";

import { TranslationsRepository, type TranslationOverlayInput } from "./repository";
import { TranslationsService } from "./service";

const input = {
	name: "Libro",
	language: "es",
	properties: { title: "Libro" },
	entityId: EntityId.make("entity-1"),
	populatedAt: new Date("2026-07-16T00:00:00.000Z"),
} satisfies TranslationOverlayInput;

const mockTranslationsRepository = Layer.mock(TranslationsRepository);

const makeTranslationsRepository = (
	overrides: MockOverrides<typeof mockTranslationsRepository> = {},
) =>
	mockTranslationsRepository({
		_tag: "TranslationsRepository",
		createOverlay: () => Effect.sync(() => undefined),
		findOverlay: () => Effect.succeed(null),
		findUserLanguage: () => Effect.succeed(null),
		updateOverlay: () => Effect.succeed("translation-1"),
		...overrides,
	});

const makeServiceLayer = (repository = makeTranslationsRepository()) =>
	TranslationsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				repository,
			),
		),
	);

it.effect("delegates overlay creation to the repository", () => {
	let createdInput: unknown;
	const layer = makeServiceLayer(
		makeTranslationsRepository({
			createOverlay: (received) =>
				Effect.sync(() => {
					createdInput = received;
					return undefined;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* TranslationsService;
		yield* service.create(input);
		expect(createdInput).toEqual(input);
	}).pipe(Effect.provide(layer));
});

it.effect("delegates overlay replacement to the repository", () => {
	let updatedInput: unknown;
	const layer = makeServiceLayer(
		makeTranslationsRepository({
			updateOverlay: (received) =>
				Effect.sync(() => {
					updatedInput = received;
					return "translation-1";
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* TranslationsService;
		yield* service.update(input);
		expect(updatedInput).toEqual(input);
	}).pipe(Effect.provide(layer));
});

it.effect("fails when update finds no existing overlay", () => {
	const layer = makeServiceLayer(
		makeTranslationsRepository({ updateOverlay: () => Effect.succeed(null) }),
	);

	return Effect.gen(function* () {
		const service = yield* TranslationsService;
		const exit = yield* Effect.exit(service.update(input));
		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Translation overlay not found" })));
	}).pipe(Effect.provide(layer));
});
