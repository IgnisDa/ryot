import { expect, it } from "@effect/vitest";
import { EntityId, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import type { MockOverrides } from "#lib/test-utils/effect";
import { databaseLayer, makeWorkflowEngine } from "#lib/test-utils/effect";

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
		listByEntity: () => Effect.succeed([]),
		findUserLanguage: () => Effect.succeed(null),
		upsertOverlay: () => Effect.void.pipe(Effect.as(undefined)),
		...overrides,
	});

const makeServiceLayer = (
	repository = makeTranslationsRepository(),
	engine = makeWorkflowEngine(),
) =>
	TranslationsService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(databaseLayer, Layer.succeed(WorkflowEngine, engine), repository),
		),
	);

it.effect("preserves provider provenance when enqueueing a translation fill", () => {
	const captured: Array<Parameters<WorkflowEngine["Service"]["execute"]>[1]> = [];
	const layer = makeServiceLayer(
		makeTranslationsRepository(),
		makeWorkflowEngine({
			execute: (_workflow, options) => {
				captured.push(options);
				return Effect.succeed(options.executionId);
			},
		}),
	);

	return Effect.gen(function* () {
		const service = yield* TranslationsService;
		yield* service.requestFill({
			language: "es",
			externalId: "record-1",
			entitySchemaSlug: "record",
			userId: UserId.make("user-1"),
			properties: { title: "Record" },
			entityId: EntityId.make("entity-1"),
			providerId: SandboxProviderId.make("provider-1"),
		});
		expect(captured).toMatchObject([
			{
				discard: true,
				payload: {
					language: "es",
					userId: "user-1",
					entityId: "entity-1",
					externalId: "record-1",
					providerId: "provider-1",
					entitySchemaSlug: "record",
				},
			},
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("keeps the deterministic ID and exposes translation enqueue failure", () => {
	let executionId: string | undefined;
	const layer = makeServiceLayer(
		makeTranslationsRepository(),
		makeWorkflowEngine({
			execute: (_workflow, options) => {
				executionId = options.executionId;
				return Effect.die("enqueue failed");
			},
		}),
	);

	return Effect.gen(function* () {
		const service = yield* TranslationsService;
		const exit = yield* Effect.exit(
			service.requestFill({
				language: "es",
				externalId: "record-1",
				entitySchemaSlug: "record",
				userId: UserId.make("user-1"),
				properties: { title: "Record" },
				entityId: EntityId.make("entity-1"),
				providerId: SandboxProviderId.make("provider-1"),
			}),
		);

		expect(executionId).toBe("translate-entity-1-es");
		expect(Exit.isFailure(exit)).toBe(true);
	}).pipe(Effect.provide(layer));
});

it.effect("delegates overlay upserts to the repository", () => {
	let upsertedInput: unknown;
	const layer = makeServiceLayer(
		makeTranslationsRepository({
			upsertOverlay: (received) =>
				Effect.sync(() => {
					upsertedInput = received;
					return undefined;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* TranslationsService;
		yield* service.upsert(input);
		expect(upsertedInput).toEqual(input);
	}).pipe(Effect.provide(layer));
});
