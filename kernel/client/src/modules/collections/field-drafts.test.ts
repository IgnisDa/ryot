import { describe, expect, it } from "vitest";

import { collectionFieldFrom, fieldDraftFrom, newFieldDraft } from "./field-drafts";

describe("collection field drafts", () => {
	it("converts drafts to fields with typed defaults and trimmed choices", () => {
		expect(
			collectionFieldFrom({
				...newFieldDraft(),
				type: "number",
				label: " Score ",
				description: "  ",
				defaultValue: "4.5",
			}),
		).toEqual({ label: "Score", type: "number", required: false, defaultValue: 4.5 });
		expect(
			collectionFieldFrom({
				...newFieldDraft(),
				key: "mood",
				label: "Mood",
				type: "choice",
				required: true,
				defaultValue: "calm",
				choices: " calm \n\n busy ",
			}),
		).toEqual({
			key: "mood",
			label: "Mood",
			type: "choice",
			required: true,
			defaultValue: "calm",
			choices: ["calm", "busy"],
		});
		expect(
			collectionFieldFrom({
				...newFieldDraft(),
				label: "Done",
				type: "boolean",
				defaultValue: "false",
			}),
		).toEqual({ label: "Done", type: "boolean", required: false, defaultValue: false });
	});

	it("drops defaults a field type cannot carry or cannot parse", () => {
		expect(
			collectionFieldFrom({
				...newFieldDraft(),
				label: "Tags",
				type: "text-list",
				defaultValue: "a",
			}),
		).toEqual({ label: "Tags", required: false, type: "text-list" });
		expect(
			collectionFieldFrom({
				...newFieldDraft(),
				label: "Count",
				type: "number",
				defaultValue: "x",
			}),
		).toEqual({ label: "Count", type: "number", required: false });
	});

	it("round-trips a stored field through its draft", () => {
		const field = {
			type: "date",
			required: true,
			key: "picked-on",
			label: "Picked on",
			defaultValue: "2026-10-20",
			description: "When it was picked",
		} as const;
		expect(collectionFieldFrom(fieldDraftFrom(field))).toEqual(field);
	});
});
