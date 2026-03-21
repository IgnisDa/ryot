import { describe, expect, it } from "bun:test";
import { expectDataResult } from "~/lib/test-helpers";
import type {
	CreateSavedViewBody,
	ListedSavedView,
	SavedViewQueryDefinition,
	UpdateSavedViewBody,
} from "./schemas";
import {
	buildBuiltinSavedViewName,
	cloneSavedView,
	createSavedView,
	deleteSavedView,
	resolveSavedViewName,
	type SavedViewServiceDeps,
	updateSavedView,
} from "./service";

const createQueryDefinition = (): SavedViewQueryDefinition => ({
	filters: [],
	entitySchemaSlugs: ["books"],
	sort: { field: ["@name"], direction: "asc" },
});

const createSavedViewBody = (): CreateSavedViewBody => ({
	icon: "book",
	name: "Reading",
	trackerId: "tracker_1",
	accentColor: "#123456",
	queryDefinition: createQueryDefinition(),
	displayConfiguration: {
		layout: "grid",
		table: { columns: [{ property: ["@name"] }] },
		grid: {
			badgeProperty: null,
			subtitleProperty: null,
			titleProperty: ["@name"],
			imageProperty: ["@image"],
		},
		list: {
			badgeProperty: null,
			subtitleProperty: null,
			titleProperty: ["@name"],
			imageProperty: ["@image"],
		},
	},
});

const createUpdateSavedViewBody = (): UpdateSavedViewBody => ({
	...createSavedViewBody(),
	name: "Updated Reading",
});

const createListedSavedView = (
	overrides: Partial<ListedSavedView> = {},
): ListedSavedView => ({
	id: "view_1",
	icon: "book",
	name: "Reading",
	isBuiltin: false,
	trackerId: "tracker_1",
	accentColor: "#123456",
	queryDefinition: createQueryDefinition(),
	createdAt: new Date("2024-01-01T00:00:00.000Z"),
	updatedAt: new Date("2024-01-01T00:00:00.000Z"),
	displayConfiguration: createSavedViewBody().displayConfiguration,
	...overrides,
});

const createDeps = (
	overrides: Partial<SavedViewServiceDeps> = {},
): SavedViewServiceDeps => ({
	createSavedViewForUser: async (input) =>
		createListedSavedView({
			icon: input.icon,
			name: input.name,
			isBuiltin: input.isBuiltin,
			accentColor: input.accentColor,
			trackerId: input.trackerId ?? null,
			queryDefinition: input.queryDefinition,
			displayConfiguration: input.displayConfiguration,
		}),
	deleteSavedViewByIdForUser: async (input) =>
		createListedSavedView({ id: input.viewId }),
	getSavedViewByIdForUser: async (input) =>
		createListedSavedView({ id: input.viewId }),
	updateSavedViewByIdForUser: async (input) =>
		createListedSavedView({
			id: input.viewId,
			icon: input.data.icon,
			name: input.data.name,
			accentColor: input.data.accentColor,
			trackerId: input.data.trackerId ?? null,
			queryDefinition: input.data.queryDefinition,
			displayConfiguration: input.data.displayConfiguration,
		}),
	...overrides,
});

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
		const deps = createDeps({
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
		const deps = createDeps({
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
	it("prevents updates to built-in views", async () => {
		let wasCalled = false;
		const deps = createDeps({
			getSavedViewByIdForUser: async () =>
				createListedSavedView({ isBuiltin: true }),
			updateSavedViewByIdForUser: async () => {
				wasCalled = true;
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

		expect(result).toEqual({
			error: "builtin",
			message: "Cannot modify built-in saved views",
		});
		expect(wasCalled).toBe(false);
	});

	it("returns not found when the row disappears before update", async () => {
		const deps = createDeps({
			updateSavedViewByIdForUser: async () => undefined,
			getSavedViewByIdForUser: async () => undefined,
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

	it("returns builtin when the view becomes protected before update", async () => {
		let getCallCount = 0;
		const deps = createDeps({
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
		const deps = createDeps({
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
		const deps = createDeps({
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
		const deps = createDeps({
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
		const deps = createDeps({
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
