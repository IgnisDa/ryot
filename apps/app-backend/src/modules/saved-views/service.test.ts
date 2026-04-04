import { describe, expect, it } from "bun:test";
import {
	createListedSavedView,
	createReorderSavedViewsBody,
	createSavedViewBody,
	createSavedViewDeps,
	createUpdateSavedViewBody,
} from "~/lib/test-fixtures";
import { expectDataResult } from "~/lib/test-helpers";
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
	it("normalizes the name before persisting", async () => {
		let createdName: string | undefined;
		const deps = createSavedViewDeps({
			createSavedViewForUser: async (input) => {
				createdName = input.name;
				return createListedSavedView({ name: input.name });
			},
		});

		const createdView = expectDataResult(
			await createSavedView(
				{
					userId: "user_1",
					body: { ...createSavedViewBody(), name: "  Reading List  " },
				},
				deps,
			),
		);

		expect(createdName).toBe("Reading List");
		expect(createdView.name).toBe("Reading List");
	});

	it("returns validation errors without persisting", async () => {
		let wasCalled = false;
		const deps = createSavedViewDeps({
			createSavedViewForUser: async () => {
				wasCalled = true;
				return createListedSavedView();
			},
		});

		const result = await createSavedView(
			{
				userId: "user_1",
				body: { ...createSavedViewBody(), name: "   " },
			},
			deps,
		);

		expect(result).toEqual({
			error: "validation",
			message: "Saved view name is required",
		});
		expect(wasCalled).toBe(false);
	});
});

describe("updateSavedView", () => {
	it("passes the current scope when moving a mutable saved view", async () => {
		let updatedCurrentTrackerId: string | null | undefined;
		const deps = createSavedViewDeps({
			getSavedViewByIdForUser: async () =>
				createListedSavedView({ trackerId: "tracker_1" }),
			updateSavedViewByIdForUser: async (input) => {
				updatedCurrentTrackerId = input.currentTrackerId;
				return createListedSavedView({
					trackerId: input.data.trackerId ?? null,
				});
			},
		});

		const result = expectDataResult(
			await updateSavedView(
				{
					viewId: "view_1",
					userId: "user_1",
					body: { ...createUpdateSavedViewBody(), trackerId: undefined },
				},
				deps,
			),
		);

		expect(updatedCurrentTrackerId).toBe("tracker_1");
		expect(result.trackerId).toBeNull();
	});

	it("allows toggling isDisabled on a built-in view without calling full update", async () => {
		let fullUpdateCalled = false;
		let disableToggleCalled = false;
		const deps = createSavedViewDeps({
			getSavedViewByIdForUser: async () =>
				createListedSavedView({ isBuiltin: true, isDisabled: false }),
			updateSavedViewByIdForUser: async () => {
				fullUpdateCalled = true;
				return createListedSavedView();
			},
			updateSavedViewDisabledByIdForUser: async (input) => {
				disableToggleCalled = true;
				return createListedSavedView({ isDisabled: input.isDisabled });
			},
		});

		const result = await updateSavedView(
			{
				viewId: "view_1",
				userId: "user_1",
				body: { ...createUpdateSavedViewBody(), isDisabled: true },
			},
			deps,
		);

		expect(fullUpdateCalled).toBe(false);
		expect(disableToggleCalled).toBe(true);
		expect("data" in result && result.data.isDisabled).toBe(true);
	});

	it("returns not_found when a built-in view row disappears during disable toggle", async () => {
		const deps = createSavedViewDeps({
			getSavedViewByIdForUser: async () =>
				createListedSavedView({ isBuiltin: true }),
			updateSavedViewDisabledByIdForUser: async () => undefined,
		});

		const result = await updateSavedView(
			{
				viewId: "view_1",
				userId: "user_1",
				body: createUpdateSavedViewBody(),
			},
			deps,
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Saved view not found",
		});
	});

	it("returns not found when the row disappears before update", async () => {
		let disableToggleCalled = false;
		const deps = createSavedViewDeps({
			updateSavedViewByIdForUser: async () => undefined,
			getSavedViewByIdForUser: async () => undefined,
			updateSavedViewDisabledByIdForUser: async () => {
				disableToggleCalled = true;
				return createListedSavedView();
			},
		});

		const result = await updateSavedView(
			{
				viewId: "view_1",
				userId: "user_1",
				body: createUpdateSavedViewBody(),
			},
			deps,
		);

		expect(disableToggleCalled).toBe(false);
		expect(result).toEqual({
			error: "not_found",
			message: "Saved view not found",
		});
	});

	it("returns builtin when the view becomes protected before update", async () => {
		let getCallCount = 0;
		const deps = createSavedViewDeps({
			getSavedViewByIdForUser: async () => {
				getCallCount += 1;
				return getCallCount === 1
					? createListedSavedView({ isBuiltin: false })
					: createListedSavedView({ isBuiltin: true });
			},
			updateSavedViewByIdForUser: async () => undefined,
		});

		const result = await updateSavedView(
			{
				viewId: "view_1",
				userId: "user_1",
				body: createUpdateSavedViewBody(),
			},
			deps,
		);

		expect(result).toEqual({
			error: "builtin",
			message: "Cannot modify built-in saved views",
		});
	});
});

describe("deleteSavedView", () => {
	it("returns not found when the saved view does not exist", async () => {
		const deps = createSavedViewDeps({
			getSavedViewByIdForUser: async () => undefined,
		});

		const result = await deleteSavedView(
			{ viewId: "view_1", userId: "user_1" },
			deps,
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Saved view not found",
		});
	});

	it("returns builtin when the view becomes protected before delete", async () => {
		let getCallCount = 0;
		const deps = createSavedViewDeps({
			deleteSavedViewByIdForUser: async () => undefined,
			getSavedViewByIdForUser: async () => {
				getCallCount += 1;
				return getCallCount === 1
					? createListedSavedView({ isBuiltin: false })
					: createListedSavedView({ isBuiltin: true });
			},
		});

		const result = await deleteSavedView(
			{ viewId: "view_1", userId: "user_1" },
			deps,
		);

		expect(result).toEqual({
			error: "builtin",
			message: "Cannot modify built-in saved views",
		});
	});
});

describe("cloneSavedView", () => {
	it("creates a user-defined copy with a normalized name", async () => {
		let createdTrackerId: string | undefined;
		let createdName: string | undefined;
		const deps = createSavedViewDeps({
			createSavedViewForUser: async (input) => {
				createdName = input.name;
				createdTrackerId = input.trackerId;
				return createListedSavedView({
					name: input.name,
					trackerId: input.trackerId ?? null,
				});
			},
			getSavedViewByIdForUser: async () =>
				createListedSavedView({ name: "  Reading  ", trackerId: null }),
		});

		const clonedView = expectDataResult(
			await cloneSavedView({ viewId: "view_1", userId: "user_1" }, deps),
		);

		expect(createdName).toBe("Reading   (Copy)");
		expect(createdTrackerId).toBeUndefined();
		expect(clonedView.name).toBe("Reading   (Copy)");
		expect(clonedView.trackerId).toBeNull();
	});

	it("returns not found when cloning a missing view", async () => {
		const deps = createSavedViewDeps({
			getSavedViewByIdForUser: async () => undefined,
		});

		const result = await cloneSavedView(
			{ viewId: "view_1", userId: "user_1" },
			deps,
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Saved view not found",
		});
	});
});

describe("reorderSavedViews", () => {
	it("keeps unspecified saved views after the requested order in a tracker", async () => {
		const reordered = expectDataResult(
			await reorderSavedViews(
				{ body: createReorderSavedViewsBody(), userId: "user_1" },
				createSavedViewDeps(),
			),
		);

		expect(reordered.viewIds).toEqual(["view_2", "view_1", "view_3"]);
	});

	it("supports reordering top-level saved views", async () => {
		let receivedTrackerId: string | undefined;
		const reordered = expectDataResult(
			await reorderSavedViews(
				{
					userId: "user_1",
					body: createReorderSavedViewsBody({
						trackerId: undefined,
						viewIds: ["view_3", "view_1"],
					}),
				},
				createSavedViewDeps({
					countSavedViewsByIdsForUser: async (input) => {
						receivedTrackerId = input.trackerId;
						return input.viewIds.length;
					},
				}),
			),
		);

		expect(receivedTrackerId).toBeUndefined();
		expect(reordered.viewIds).toEqual(["view_3", "view_1", "view_2"]);
	});

	it("returns validation for unknown saved view ids", async () => {
		const result = await reorderSavedViews(
			{ body: createReorderSavedViewsBody(), userId: "user_1" },
			createSavedViewDeps({ countSavedViewsByIdsForUser: async () => 1 }),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Saved view ids contain unknown saved views",
		});
	});

	it("returns validation when persistence cannot update the full scoped order", async () => {
		const result = await reorderSavedViews(
			{ body: createReorderSavedViewsBody(), userId: "user_1" },
			createSavedViewDeps({
				persistSavedViewOrderForUser: async () => undefined,
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Saved view ids contain unknown saved views",
		});
	});
});
