import { describe, expect, it } from "bun:test";
import { buildTrackerOrder, resolveTrackerPatch } from "./service";

describe("resolveTrackerPatch", () => {
	it("keeps current slug when neither name nor slug changes", () => {
		const patch = resolveTrackerPatch({
			current: {
				icon: "film",
				slug: "media",
				name: "Media",
				description: null,
				accentColor: "#5B7FFF",
			},
			input: { description: "Default media tracker" },
		});

		expect(patch.slug).toBe("media");
		expect(patch.description).toBe("Default media tracker");
	});

	it("keeps current slug even when name changes", () => {
		const patch = resolveTrackerPatch({
			current: {
				icon: "coffee",
				slug: "whiskey",
				name: "Whiskey",
				description: null,
				accentColor: "#D4A574",
			},
			input: { name: "Whiskey Notes" },
		});

		expect(patch.slug).toBe("whiskey");
		expect(patch.name).toBe("Whiskey Notes");
	});

	it("keeps the current icon when icon is omitted", () => {
		const patch = resolveTrackerPatch({
			current: {
				icon: "film",
				slug: "media",
				name: "Media",
				description: null,
				accentColor: "#5B7FFF",
			},
			input: { description: "Track media" },
		});

		expect(patch.icon).toBe("film");
	});

	it("keeps the current accent color when accentColor is omitted", () => {
		const patch = resolveTrackerPatch({
			current: {
				icon: "film",
				slug: "media",
				name: "Media",
				description: null,
				accentColor: "#5B7FFF",
			},
			input: { icon: "camera", description: "Track media" },
		});

		expect(patch.accentColor).toBe("#5B7FFF");
	});
});

describe("buildTrackerOrder", () => {
	it("keeps unspecified trackers after requested order", () => {
		const nextOrder = buildTrackerOrder({
			currentTrackerIds: ["a", "b", "c", "d"],
			requestedTrackerIds: ["c", "a"],
		});

		expect(nextOrder).toEqual(["c", "a", "b", "d"]);
	});

	it("supports new trackers in requested order", () => {
		const nextOrder = buildTrackerOrder({
			currentTrackerIds: ["a", "b"],
			requestedTrackerIds: ["x", "b"],
		});

		expect(nextOrder).toEqual(["x", "b", "a"]);
	});
});
