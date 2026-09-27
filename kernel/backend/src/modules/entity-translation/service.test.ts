import { expect, layer } from "@effect/vitest";
import { EntityId, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Exit, Layer, Ref } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

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

type ExecuteOptions = Parameters<WorkflowEngine["Service"]["execute"]>[1];

class FakeTranslationDependencies extends Context.Service<
	FakeTranslationDependencies,
	{
		readonly executions: Effect.Effect<ReadonlyArray<ExecuteOptions>>;
		readonly upserts: Effect.Effect<ReadonlyArray<TranslationOverlayInput>>;
	}
>()("test/FakeTranslationDependencies") {}

const makeServiceLayer = (
	enqueue: (options: ExecuteOptions) => Effect.Effect<unknown> = (options) =>
		Effect.succeed(options.executionId),
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const executions = yield* Ref.make<ReadonlyArray<ExecuteOptions>>([]);
			const upserts = yield* Ref.make<ReadonlyArray<TranslationOverlayInput>>([]);
			const repository = Layer.mock(TranslationsRepository)({
				findUserLanguage: () => Effect.succeed(null),
				upsertOverlay: (received) =>
					Ref.update(upserts, (all) => [...all, received]).pipe(
						Effect.as({ entityId: received.entityId, language: received.language }),
					),
			});
			const engine = makeWorkflowEngine({
				execute: (_workflow, options) =>
					Ref.update(executions, (all) => [...all, options]).pipe(Effect.andThen(enqueue(options))),
			});
			return TranslationsService.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(databaseLayer, Layer.succeed(WorkflowEngine, engine), repository),
				),
				Layer.merge(
					Layer.succeed(FakeTranslationDependencies, {
						upserts: Ref.get(upserts),
						executions: Ref.get(executions),
					}),
				),
			);
		}),
	);

layer(makeServiceLayer())((test) => {
	test.effect("preserves provider provenance when enqueueing a translation fill", () =>
		Effect.gen(function* () {
			const service = yield* TranslationsService;
			yield* service.requestFill({
				language: "es",
				externalId: "record-1",
				entitySchemaSlug: "record",
				userId: UserId.make("user-1"),
				properties: { title: "Record" },
				entityId: EntityId.make("entity-1"),
				providerId: SandboxProviderId.make("provider-1"),
				accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
			});
			expect(yield* (yield* FakeTranslationDependencies).executions).toMatchObject([
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
		}),
	);
});

layer(makeServiceLayer(() => Effect.die("enqueue failed")))((test) => {
	test.effect("keeps the deterministic ID and exposes translation enqueue failure", () =>
		Effect.gen(function* () {
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
					accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
				}),
			);

			const executions = yield* (yield* FakeTranslationDependencies).executions;
			expect(executions.map(({ executionId }) => executionId)).toEqual(["translate-entity-1-es"]);
			expect(Exit.isFailure(exit)).toBe(true);
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect("delegates overlay upserts to the repository", () =>
		Effect.gen(function* () {
			const service = yield* TranslationsService;
			expect(yield* service.upsert(input)).toEqual({
				entityId: input.entityId,
				language: input.language,
			});
			expect(yield* (yield* FakeTranslationDependencies).upserts).toEqual([input]);
		}),
	);
});
