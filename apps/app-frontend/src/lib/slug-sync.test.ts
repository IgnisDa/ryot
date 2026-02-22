import { describe, expect, it } from "bun:test";

import { createNameFieldListeners, resolveNextSlug, syncSlugOnNameChange } from "./slug-sync";

describe("resolveNextSlug", () => {
	it("derives the slug while it is blank", () => {
		expect(
			resolveNextSlug({
				slug: "",
				name: "  Shelf Status  ",
				previousDerivedSlug: "shelf",
			}),
		).toBe("shelf-status");
	});

	it("keeps auto-updating while the slug still matches the previous derivation", () => {
		expect(
			resolveNextSlug({
				name: "Reading Status",
				slug: "reading-status-old",
				previousDerivedSlug: "reading-status-old",
			}),
		).toBe("reading-status");
	});

	it("preserves a customized slug", () => {
		expect(
			resolveNextSlug({
				slug: "house-special",
				name: "Reading Status",
				previousDerivedSlug: "reading-status",
			}),
		).toBe("house-special");
	});

	it("clears the slug when the name is cleared and it was still auto-derived", () => {
		expect(
			resolveNextSlug({
				name: "   ",
				slug: "reading-status",
				previousDerivedSlug: "reading-status",
			}),
		).toBe("");
	});

	it("handles undefined previousDerivedSlug", () => {
		expect(
			resolveNextSlug({
				slug: "",
				name: "New Item",
			}),
		).toBe("new-item");
	});
});

describe("syncSlugOnNameChange", () => {
	it("updates the slug field when in auto-derived mode", () => {
		const updates: string[] = [];

		const shouldTrackDerivedSlug = syncSlugOnNameChange({
			name: "Finished Reading",
			previousDerivedSlug: "reading-status",
			form: {
				getFieldValue: () => "reading-status",
				setFieldValue: (_field: "slug", value: string) => updates.push(value),
			},
		});

		expect(updates).toEqual(["finished-reading"]);
		expect(shouldTrackDerivedSlug).toBeTrue();
	});

	it("preserves a customized slug and returns false", () => {
		const updates: string[] = [];

		const shouldTrackDerivedSlug = syncSlugOnNameChange({
			name: "Finished Reading",
			previousDerivedSlug: "reading-status",
			form: {
				getFieldValue: () => "my-custom-slug",
				setFieldValue: (_field: "slug", value: string) => updates.push(value),
			},
		});

		expect(updates).toEqual([]);
		expect(shouldTrackDerivedSlug).toBeFalse();
	});

	it("returns true when slug is blank (auto-derived mode)", () => {
		const updates: string[] = [];

		const shouldTrackDerivedSlug = syncSlugOnNameChange({
			name: "New Name",
			previousDerivedSlug: "old-slug",
			form: {
				getFieldValue: () => "",
				setFieldValue: (_field: "slug", value: string) => updates.push(value),
			},
		});

		expect(updates).toEqual(["new-name"]);
		expect(shouldTrackDerivedSlug).toBeTrue();
	});

	it("does not update field when next slug equals current slug", () => {
		const updates: string[] = [];

		const shouldTrackDerivedSlug = syncSlugOnNameChange({
			name: "Reading Status",
			previousDerivedSlug: "reading-status",
			form: {
				getFieldValue: () => "reading-status",
				setFieldValue: (_field: "slug", value: string) => updates.push(value),
			},
		});

		expect(updates).toEqual([]);
		expect(shouldTrackDerivedSlug).toBeTrue();
	});
});

describe("createNameFieldListeners", () => {
	it("updates the tracked derived slug across sequential name changes", () => {
		let slug = "reading-status";
		const previousDerivedSlug = { current: "reading-status" };
		const listeners = createNameFieldListeners({
			previousDerivedSlug,
			form: {
				getFieldValue: (field) => (field === "slug" ? slug : ""),
				setFieldValue: (_field, value) => {
					slug = value;
				},
			},
		});

		listeners.onChange({ value: "Finished Reading" });

		expect(slug).toBe("finished-reading");
		expect(previousDerivedSlug.current).toBe("finished-reading");

		listeners.onChange({ value: "Reading Complete" });

		expect(slug).toBe("reading-complete");
		expect(previousDerivedSlug.current).toBe("reading-complete");
	});

	it("keeps a prefilled customized slug unchanged on the first name change", () => {
		let slug = "custom-schema";
		const previousDerivedSlug = { current: "reading-status" };
		const listeners = createNameFieldListeners({
			previousDerivedSlug,
			form: {
				getFieldValue: (field) => (field === "slug" ? slug : ""),
				setFieldValue: (_field, value) => {
					slug = value;
				},
			},
		});

		listeners.onChange({ value: "Finished Reading" });

		expect(slug).toBe("custom-schema");
		expect(previousDerivedSlug.current).toBe("reading-status");
	});

	it("does not start syncing again after a customized slug matches a later derivation", () => {
		let slug = "finished-reading";
		const previousDerivedSlug = { current: "reading-status" };
		const listeners = createNameFieldListeners({
			previousDerivedSlug,
			form: {
				getFieldValue: (field) => (field === "slug" ? slug : ""),
				setFieldValue: (_field, value) => {
					slug = value;
				},
			},
		});

		listeners.onChange({ value: "Finished Reading" });
		listeners.onChange({ value: "Reading Complete" });

		expect(slug).toBe("finished-reading");
		expect(previousDerivedSlug.current).toBe("reading-status");
	});
});
