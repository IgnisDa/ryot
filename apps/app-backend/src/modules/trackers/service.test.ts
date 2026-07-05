import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { NotFound } from "@ryot/contract/errors";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer } from "#lib/test-utils/effect";
import { DefinitionRegistry } from "#modules/definition-registry/service";

import { TrackersRepository } from "./repository";
import { TrackersService } from "./service";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const mockRepository = Layer.mock(TrackersRepository);

const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ _tag: "TrackersRepository", ...overrides });

const makeServiceLayer = (repository: ReturnType<typeof makeRepository>) =>
	TrackersService.Default.pipe(
		Layer.provide(Layer.mergeAll(dbRunnerLayer, DefinitionRegistry.Default, repository)),
	);

const makeState = (
	overrides: Partial<{
		config: Record<string, unknown>;
		trackerSlug: string;
		sortOrder: number;
		isDisabled: boolean;
	}> = {},
) => ({
	id: "state-id",
	userId: user.id,
	config: {},
	trackerSlug: "media",
	sortOrder: 0,
	isDisabled: false,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
	...overrides,
});

it.effect("lists definition-backed trackers with user state overlaid", () => {
	const layer = makeServiceLayer(
		makeRepository({
			listStates: () =>
				Effect.succeed([
					makeState({ config: { layout: "compact" }, sortOrder: 5 }),
					makeState({ trackerSlug: "fitness", isDisabled: true, sortOrder: 0 }),
				]),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* TrackersService;

		const visible = yield* service.list(user, false);
		const all = yield* service.list(user, true);

		expect(visible.map(({ slug }) => slug)).toEqual(["media"]);
		expect(visible[0]).toMatchObject({
			config: { layout: "compact" },
			slug: "media",
			name: "Media",
			sortOrder: 5,
			isDisabled: false,
		});
		expect(all.map(({ slug }) => slug)).toEqual(["fitness", "media"]);
	}).pipe(Effect.provide(layer));
});

it.effect("updates state while preserving omitted overlay values", () => {
	let persisted:
		| Parameters<NonNullable<MockOverrides<typeof mockRepository>["upsertState"]>>[0]
		| undefined;
	const current = makeState({ config: { unit: "minutes" }, sortOrder: 4 });
	const layer = makeServiceLayer(
		makeRepository({
			getState: () => Effect.succeed(current),
			upsertState: (input) =>
				Effect.sync(() => {
					persisted = input;
					return makeState(input);
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* TrackersService;
		const tracker = yield* service.updateState(user, "media", { isDisabled: true });

		expect(persisted).toEqual({
			userId: user.id,
			trackerSlug: "media",
			config: { unit: "minutes" },
			sortOrder: 4,
			isDisabled: true,
		});
		expect(tracker).toMatchObject({
			config: { unit: "minutes" },
			slug: "media",
			name: "Media",
			sortOrder: 4,
			isDisabled: true,
		});
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when updating an unknown tracker definition", () => {
	const layer = makeServiceLayer(makeRepository());

	return Effect.gen(function* () {
		const service = yield* TrackersService;
		const exit = yield* Effect.exit(service.updateState(user, "unknown", { isDisabled: true }));

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Tracker not found" })));
	}).pipe(Effect.provide(layer));
});
