import { CollectionBadRequest } from "@ryot-app/contract/modules/collections/schemas";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { prepareCollectionFields } from "./fields";

const text = (label: string, key?: string) => ({
	label,
	required: false,
	type: "text" as const,
	...(key === undefined ? {} : { key }),
});

const keysOf = (result: ReturnType<typeof prepareCollectionFields>) =>
	Result.isSuccess(result) ? result.success.map(({ key }) => key) : result.failure;

describe("prepareCollectionFields", () => {
	it("generates stable slug keys that avoid reserved and stored keys", () => {
		const keys = keysOf(
			prepareCollectionFields(
				[
					text("Owned On"),
					text("Owned On"),
					text("Rank"),
					text("Constructor"),
					text("Prototype"),
					text("123 Go!"),
					text("日本"),
					text("Note"),
					text("Kept", "kept"),
				],
				new Set(["note", "kept"]),
			),
		);
		expect(keys).toEqual([
			"owned-on",
			"owned-on-2",
			"rank-2",
			"constructor-2",
			"prototype-2",
			"go",
			"field",
			"note-2",
			"kept",
		]);
		for (const key of Array.isArray(keys) ? keys : []) {
			expect(key).toMatch(/^[a-z][a-z0-9-]*$/);
		}
	});

	it("rejects reserved keys before other field issues", () => {
		expect(
			prepareCollectionFields(
				[text("", "__proto__"), text("Note", "constructor"), text("Ok", "prototype")],
				new Set(),
			),
		).toEqual(
			Result.fail(
				new CollectionBadRequest({
					reason: {
						code: "reserved-field-key",
						paths: [
							["fields", "0", "key"],
							["fields", "1", "key"],
							["fields", "2", "key"],
						],
					},
				}),
			),
		);
	});

	it("rejects duplicate provided keys and over-long text", () => {
		expect(
			prepareCollectionFields(
				[
					text("A", "kept"),
					{ ...text("B", "kept"), description: "d".repeat(501) },
					{ label: "C", type: "choice", required: false, choices: ["x".repeat(101)] },
				],
				new Set(["kept"]),
			),
		).toEqual(
			Result.fail(
				new CollectionBadRequest({
					reason: {
						code: "invalid-fields",
						paths: [
							["fields", "1", "description"],
							["fields", "1", "key"],
							["fields", "2", "choices", "0"],
						],
					},
				}),
			),
		);
	});

	it("validates defaults against the compiled field", () => {
		expect(
			Result.isSuccess(
				prepareCollectionFields(
					[
						{ type: "date", label: "Seen", required: false, defaultValue: "2026-01-01" },
						{
							label: "Moods",
							required: false,
							choices: ["Calm"],
							type: "multi-choice",
							defaultValue: ["Calm"],
						},
					],
					new Set(),
				),
			),
		).toBe(true);
		expect(
			prepareCollectionFields(
				[
					{
						label: "Moods",
						required: false,
						choices: ["Calm"],
						type: "multi-choice",
						defaultValue: ["Loud"],
					},
				],
				new Set(),
			),
		).toEqual(
			Result.fail(
				new CollectionBadRequest({
					reason: { code: "invalid-fields", paths: [["fields", "0", "defaultValue"]] },
				}),
			),
		);
	});
});
