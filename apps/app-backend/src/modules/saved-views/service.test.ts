import { describe, expect, it } from "bun:test";
import {
	createListedSavedView,
	createReorderSavedViewsBody,
	createSavedViewBody,
	createSavedViewDeps,
	createUpdateSavedViewBody,
} from "~/lib/test-fixtures";
import { expectDataResult } from "~/lib/test-helpers";
import { QueryEngineValidationError } from "~/lib/views/errors";
import {
	buildBuiltinSavedViewName,
	cloneSavedView,
	createSavedView,
	deleteSavedView,
	reorderSavedViews,
	resolveSavedViewName,
	updateSavedView,
} from "./service";

describe("resolveSavedViewName", () => {
	it("trims the provided name", () => {
		expect(resolveSavedViewName("  My Saved View  ")).toBe("My Saved View");
	});

	it("throws when the name is blank", () => {
		expect(() => resolveSavedViewName("   ")).toThrow(
			"Saved view name is required",
		);
	});
});

describe("buildBuiltinSavedViewName", () => {
	it("returns formatted name for entity schema", () => {
		expect(buildBuiltinSavedViewName("Whiskey")).toBe("All Whiskeys");
	});

	it("handles singular names correctly", () => {
		expect(buildBuiltinSavedViewName("Book")).toBe("All Books");
	});
});

describe("createSavedView", () => {
	it("persists a valid saved view after validation", async () => {
		let validated = false;
		let createdName: string | undefined;
		const deps = createSavedViewDeps({
			prepareForValidation: async () => {
				validated = true;
			},
			createSavedViewForUser: async (input) => {
				createdName = input.name;
				return createListedSavedView({ name: input.name });
			},
		});

		const savedView = expectDataResult(
			await createSavedView(
				{
					userId: "user_1",
					body: createSavedViewBody({ name: "  Reading List  " }),
				},
				deps,
			),
		);

		expect(validated).toBe(true);
		expect(createdName).toBe("Reading List");
		expect(savedView.name).toBe("Reading List");
	});

	it("returns validation before persisting an invalid definition", async () => {
		let wasPersisted = false;
		const deps = createSavedViewDeps({
			prepareForValidation: async () => {
				throw new QueryEngineValidationError("Invalid filter predicate");
			},
			createSavedViewForUser: async () => {
				wasPersisted = true;
				return createListedSavedView();
			},
		});

		const result = await createSavedView(
			{ userId: "user_1", body: createSavedViewBody() },
			deps,
		);

		expect(result).toEqual({
			error: "validation",
			message: "Invalid filter predicate",
		});
		expect(wasPersisted).toBe(false);
	});

	it("rethrows unexpected validation failures", async () => {
		const deps = createSavedViewDeps({
			prepareForValidation: async () => {
				throw new Error("Database connection lost");
			},
		});

		expect(
			createSavedView({ userId: "user_1", body: createSavedViewBody() }, deps),
		).rejects.toThrow("Database connection lost");
	});

	it("returns validation before persisting unsupported saved view query modes", async () => {
		let wasPersisted = false;
		const deps = createSavedViewDeps({
			prepareForValidation: async () => {
				throw new QueryEngineValidationError(
					"Saved view display configuration only supports entity mode queries",
				);
			},
			createSavedViewForUser: async () => {
				wasPersisted = true;
				return createListedSavedView();
			},
		});

		const result = await createSavedView(
			{ userId: "user_1", body: createSavedViewBody() },
			deps,
		);

		expect(result).toEqual({
			error: "validation",
			message:
				"Saved view display configuration only supports entity mode queries",
		});
		expect(wasPersisted).toBe(false);
	});
});

describe("updateSavedView", () => {
	it("rejects built-in definition changes while still allowing disable toggles", async () => {
		const deps = createSavedViewDeps({
			getSavedViewBySlugForUser: async () =>
				createListedSavedView({ isBuiltin: true, name: "Books" }),
		});

		const result = await updateSavedView(
			{
				userId: "user_1",
				viewSlug: "view_1",
				body: createUpdateSavedViewBody({ name: "Renamed Books" }),
			},
			deps,
		);

		expect(result).toEqual({
			error: "validation",
			message: "Cannot modify built-in saved views",
		});
	});

	it("returns validation error before persisting an invalid definition", async () => {
		let wasPersisted = false;
		const deps = createSavedViewDeps({
			getSavedViewBySlugForUser: async () => createListedSavedView(),
			prepareForValidation: async () => {
				throw new QueryEngineValidationError("Invalid sort expression");
			},
			updateSavedViewBySlugForUser: async () => {
				wasPersisted = true;
				return createListedSavedView();
			},
		});

		const result = await updateSavedView(
			{
				userId: "user_1",
				viewSlug: "view_1",
				body: createUpdateSavedViewBody(),
			},
			deps,
		);

		expect(result).toEqual({
			error: "validation",
			message: "Invalid sort expression",
		});
		expect(wasPersisted).toBe(false);
	});

	it("re-validates and persists mutable updates", async () => {
		let validated = false;
		let currentTrackerId: string | null | undefined;
		const deps = createSavedViewDeps({
			prepareForValidation: async () => {
				validated = true;
			},
			getSavedViewBySlugForUser: async () =>
				createListedSavedView({ trackerId: "tracker_1" }),
			updateSavedViewBySlugForUser: async (input) => {
				currentTrackerId = input.currentTrackerId;
				return createListedSavedView({
					slug: input.viewSlug,
					name: input.data.name,
					trackerId: input.data.trackerId ?? null,
				});
			},
		});

		const view = expectDataResult(
			await updateSavedView(
				{
					userId: "user_1",
					viewSlug: "view_1",
					body: createUpdateSavedViewBody({
						trackerId: undefined,
						name: "  Updated Reading  ",
					}),
				},
				deps,
			),
		);

		expect(validated).toBe(true);
		expect(currentTrackerId).toBe("tracker_1");
		expect(view.name).toBe("Updated Reading");
		expect(view.trackerId).toBeNull();
	});
});

describe("deleteSavedView", () => {
	it("rejects deleting built-in views", async () => {
		const deps = createSavedViewDeps({
			getSavedViewBySlugForUser: async () =>
				createListedSavedView({ isBuiltin: true }),
		});

		const result = await deleteSavedView(
			{ userId: "user_1", viewSlug: "view_1" },
			deps,
		);

		expect(result).toEqual({
			error: "builtin",
			message: "Cannot modify built-in saved views",
		});
	});
});

describe("cloneSavedView", () => {
	it("clones through the validation boundary with a generated name", async () => {
		let clonedName: string | undefined;
		const deps = createSavedViewDeps({
			getSavedViewBySlugForUser: async () =>
				createListedSavedView({ name: "Reading", trackerId: null }),
			createSavedViewForUser: async (input) => {
				clonedName = input.name;
				return createListedSavedView({
					name: input.name,
					trackerId: input.trackerId ?? null,
				});
			},
		});

		const clonedView = expectDataResult(
			await cloneSavedView({ userId: "user_1", viewSlug: "view_1" }, deps),
		);

		expect(clonedName).toBe("Reading (Copy)");
		expect(clonedView.name).toBe("Reading (Copy)");
		expect(clonedView.trackerId).toBeNull();
	});
});

describe("reorderSavedViews", () => {
	it("rejects reorder requests containing unknown scoped ids", async () => {
		const deps = createSavedViewDeps({
			countSavedViewsBySlugForUser: async () => 1,
		});

		const result = await reorderSavedViews(
			{
				userId: "user_1",
				body: createReorderSavedViewsBody(),
			},
			deps,
		);

		expect(result).toEqual({
			error: "validation",
			message: "Saved view slugs contain unknown saved views",
		});
	});
});
