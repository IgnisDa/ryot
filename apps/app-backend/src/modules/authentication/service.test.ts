import { describe, expect, it } from "bun:test";
import { createQueryDefinition } from "~/lib/test-fixtures";
import { defaultDisplayConfiguration } from "~/modules/saved-views/constants";
import {
	buildAuthenticationSavedViewInputs,
	buildAuthenticationTrackerEntitySchemaLinks,
	buildAuthenticationTrackerInputs,
	resolveAuthenticationName,
} from "./service";

describe("resolveAuthenticationName", () => {
	it("trims the provided signup name", () => {
		expect(resolveAuthenticationName("  New User  ")).toBe("New User");
	});

	it("throws when the signup name is blank", () => {
		expect(() => resolveAuthenticationName("   ")).toThrow(
			"Signup name is required",
		);
	});
});

describe("authentication bootstrap helpers", () => {
	it("builds built-in tracker inputs from manifests", () => {
		expect(
			buildAuthenticationTrackerInputs({
				trackers: [
					{
						icon: "film",
						slug: "media",
						name: "Media",
						accentColor: "#5B7FFF",
					},
				],
			}),
		).toEqual([
			{
				icon: "film",
				slug: "media",
				name: "Media",
				accentColor: "#5B7FFF",
				description: undefined,
			},
		]);
	});

	it("builds tracker entity schema links from built-in manifests", () => {
		expect(
			buildAuthenticationTrackerEntitySchemaLinks({
				trackers: [{ id: "tracker-1", slug: "media" }],
				entitySchemas: [{ id: "schema-1", slug: "book" }],
				schemaLinks: [{ slug: "book", trackerSlug: "media" }],
			}),
		).toEqual([{ trackerId: "tracker-1", entitySchemaId: "schema-1" }]);
	});

	it("throws when a schema link references a missing tracker", () => {
		expect(() =>
			buildAuthenticationTrackerEntitySchemaLinks({
				trackers: [],
				entitySchemas: [{ id: "schema-1", slug: "book" }],
				schemaLinks: [{ slug: "book", trackerSlug: "media" }],
			}),
		).toThrow("Missing built-in tracker for entity schema book");
	});

	it("builds built-in saved views from built-in manifests", () => {
		const queryDefinition = createQueryDefinition();

		expect(
			buildAuthenticationSavedViewInputs({
				trackers: [{ id: "tracker-1", slug: "media" }],
				entitySchemas: [
					{
						slug: "book",
						id: "schema-1",
						icon: "book-open",
						accentColor: "#5B7FFF",
					},
				],
				savedViews: [
					{
						name: "All Books",
						trackerSlug: "media",
						entitySchemaSlug: "book",
						displayConfiguration: defaultDisplayConfiguration,
					},
				],
			}),
		).toEqual([
			{
				isBuiltin: true,
				icon: "book-open",
				name: "All Books",
				trackerId: "tracker-1",
				accentColor: "#5B7FFF",
				displayConfiguration: defaultDisplayConfiguration,
				queryDefinition: { ...queryDefinition, entitySchemaSlugs: ["book"] },
			},
		]);
	});

	it("builds built-in saved views without trackers", () => {
		const queryDefinition = createQueryDefinition({ entitySchemaSlugs: [] });

		expect(
			buildAuthenticationSavedViewInputs({
				entitySchemas: [],
				trackers: [{ id: "tracker-1", slug: "media" }],
				savedViews: [
					{
						icon: "folders",
						queryDefinition,
						name: "Collections",
						accentColor: "#F59E0B",
						displayConfiguration: defaultDisplayConfiguration,
					},
				],
			}),
		).toEqual([
			{
				icon: "folders",
				queryDefinition,
				isBuiltin: true,
				name: "Collections",
				trackerId: undefined,
				accentColor: "#F59E0B",
				displayConfiguration: defaultDisplayConfiguration,
			},
		]);
	});

	it("throws when a saved view references a missing built-in entity schema", () => {
		expect(() =>
			buildAuthenticationSavedViewInputs({
				entitySchemas: [],
				trackers: [{ id: "tracker-1", slug: "media" }],
				savedViews: [
					{
						name: "All Books",
						trackerSlug: "media",
						entitySchemaSlug: "book",
						displayConfiguration: defaultDisplayConfiguration,
					},
				],
			}),
		).toThrow("Missing built-in entity schema for saved view All Books");
	});
});
