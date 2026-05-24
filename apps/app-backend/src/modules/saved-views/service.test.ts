import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { CurrentDb, DbRunner, TransactionRunner } from "#lib/db";
import { BadRequest, NotFound } from "#lib/errors";

import { SavedViewsRepository } from "./repository";
import type { ListedSavedView } from "./schemas";
import { SavedViewsService } from "./service";

const user = {
	id: "user-id",
	name: "Test User",
	email: "user@example.com",
} satisfies CurrentUserValue;

const dbRunnerLayer = Layer.succeed(DbRunner, <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const transactionLayer = Layer.succeed(
	TransactionRunner,
	<A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const baseListedSavedView: ListedSavedView = {
	id: "sv-id",
	icon: "book",
	sortOrder: 0,
	slug: "my-view",
	name: "My View",
	trackerId: null,
	isBuiltin: false,
	isDisabled: false,
	accentColor: "#FF5733",
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	queryDefinition: {
		filter: null,
		eventJoins: [],
		scope: ["book"],
		mode: "entities",
		computedFields: [],
		relationshipJoins: [],
		sort: { direction: "asc", expression: { type: "literal", value: "name" } },
	},
	displayConfiguration: {
		entityIdProperty: { type: "literal", value: "id" },
		table: { columns: [{ label: "Name", expression: { type: "literal", value: "name" } }] },
		grid: {
			imageProperty: null,
			eyebrowProperty: null,
			calloutProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
			titleProperty: { type: "literal", value: "name" },
		},
		list: {
			imageProperty: null,
			eyebrowProperty: null,
			calloutProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
			titleProperty: { type: "literal", value: "name" },
		},
	},
};

const defaultRepository = () =>
	Object.assign(Object.create(null), {
		_tag: "SavedViewsRepository" as const,
		create: () => Effect.die("unused"),
		listByUser: () => Effect.die("unused"),
		findBySlug: () => Effect.die("unused"),
		updateBySlug: () => Effect.die("unused"),
		deleteBySlug: () => Effect.die("unused"),
		countBySlugs: () => Effect.die("unused"),
		persistOrder: () => Effect.die("unused"),
		listSlugsInOrder: () => Effect.die("unused"),
		updateDisabledBySlug: () => Effect.die("unused"),
	});

const makeRepository = (overrides: Partial<SavedViewsRepository> = {}) =>
	Object.assign(Object.create(null), defaultRepository(), overrides);

const makeServiceLayer = (repository: SavedViewsRepository) =>
	SavedViewsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				Layer.succeed(SavedViewsRepository, repository),
			),
		),
	);

const createBody = {
	icon: "book",
	name: "My View",
	accentColor: "#FF5733",
	queryDefinition: baseListedSavedView.queryDefinition,
	displayConfiguration: baseListedSavedView.displayConfiguration,
};

it.effect("trims and slugifies saved view names before creating", () => {
	let createdSlug = "";

	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(null),
			create: (_userId, input) =>
				Effect.sync(() => {
					createdSlug = input.slug;
					return { ...baseListedSavedView, name: input.name, slug: input.slug };
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const view = yield* service.create(user, { ...createBody, name: "  My View  " });

		expect(createdSlug).toBe("my-view");
		expect(view.name).toBe("My View");
		expect(view.slug).toBe("my-view");
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when getting a view the user does not own", () => {
	const layer = makeServiceLayer(makeRepository({ findBySlug: () => Effect.succeed(null) }));

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(service.get(user, "non-existent"));

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Saved view not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request when deleting a built-in view", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed({ ...baseListedSavedView, isBuiltin: true }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(service.delete(user, "builtin-view"));

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Cannot modify built-in saved views" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects built-in definition changes while still allowing disable toggles", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed({ ...baseListedSavedView, name: "Books", isBuiltin: true }),
			updateDisabledBySlug: (_userId, _slug, isDisabled) =>
				Effect.succeed({ ...baseListedSavedView, isBuiltin: true, name: "Books", isDisabled }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const view = yield* service.update(user, "books", {
			...createBody,
			name: "Books",
			isDisabled: true,
		});

		expect(view.isDisabled).toBe(true);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects updating a built-in view name", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed({ ...baseListedSavedView, name: "Books", isBuiltin: true }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(
			service.update(user, "books", {
				...createBody,
				isDisabled: false,
				name: "Renamed Books",
			}),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Cannot modify built-in saved views" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("clones a saved view with (Copy) suffix", () => {
	let clonedName = "";

	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () =>
				Effect.succeed({
					...baseListedSavedView,
					name: "Reading",
					trackerId: null,
				}),
			create: (_userId, input) =>
				Effect.sync(() => {
					clonedName = input.name;
					return {
						...baseListedSavedView,
						name: input.name,
						slug: input.slug,
						trackerId: input.trackerId ?? null,
					};
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const view = yield* service.clone(user, "reading");

		expect(clonedName).toBe("Reading (Copy)");
		expect(view.name).toBe("Reading (Copy)");
		expect(view.trackerId).toBeNull();
	}).pipe(Effect.provide(layer));
});

it.effect("reorders requested slugs and appends the remaining", () => {
	let persistedSlugs: ReadonlyArray<string> = [];

	const layer = makeServiceLayer(
		makeRepository({
			countBySlugs: () => Effect.succeed(2),
			listSlugsInOrder: () => Effect.succeed(["view-a", "view-b", "view-c"]),
			persistOrder: (_userId, _trackerId, slugs) =>
				Effect.sync(() => {
					persistedSlugs = slugs;
					return slugs;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const reordered = yield* service.reorder(user, { viewSlugs: ["view-c", "view-a"] });

		expect(reordered).toEqual({ viewSlugs: ["view-c", "view-a", "view-b"] });
		expect(persistedSlugs).toEqual(["view-c", "view-a", "view-b"]);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects reorder requests containing unknown slugs", () => {
	const layer = makeServiceLayer(makeRepository({ countBySlugs: () => Effect.succeed(1) }));

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(service.reorder(user, { viewSlugs: ["view-a", "view-b"] }));

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Saved view slugs contain unknown saved views" })),
		);
	}).pipe(Effect.provide(layer));
});
