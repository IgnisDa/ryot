import { expect, it } from "bun:test";

import type { PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import { assert } from "@ryot-app/testing/assert";
import { Result } from "effect";

import { applyPageEdits, readPageDraft } from "./page-files";

const encode = (text: string) => Buffer.from(text).toString("base64");
const decode = (definition: PageDefinition) =>
	Object.fromEntries(
		definition.files.map(({ path, content }) => [path, Buffer.from(content, "base64").toString()]),
	);
const definition: PageDefinition = {
	pluginDependencies: {},
	queries: { queries: {} },
	entry: "client/page.tsx",
	files: [
		{ path: "client/page.tsx", content: encode("const a = 1;\nconst b = 1;\nexport default a;") },
		{ path: "client/image.bin", content: Buffer.from([0xff, 0xfe]).toString("base64") },
	],
};
const draft = { definition, pageId: "page", name: "Page", slug: "page", draftRevision: 3 };
const edit = (edits: Parameters<typeof applyPageEdits>[1]["edits"]) =>
	applyPageEdits(definition, { edits, pageId: "page", expectedDraftRevision: 3 });

it("lists draft files and reads numbered line ranges", () => {
	expect(readPageDraft(draft, { pageId: "page" })).toEqual(
		Result.succeed({
			name: "Page",
			slug: "page",
			pageId: "page",
			draftRevision: 3,
			pluginDependencies: {},
			entry: "client/page.tsx",
			queries: { queries: {} },
			files: [
				{ path: "client/page.tsx", lines: 3 },
				{ path: "client/image.bin", lines: null },
			],
		}),
	);
	expect(readPageDraft(draft, { pageId: "page", path: "client/page.tsx", offset: 2, limit: 1 })).toEqual(
		Result.succeed({
			endLine: 2,
			startLine: 2,
			totalLines: 3,
			draftRevision: 3,
			text: "2: const b = 1;",
			path: "client/page.tsx",
		}),
	);
	expect(readPageDraft(draft, { pageId: "page", path: "client/image.bin" })).toEqual(
		Result.fail("client/image.bin is not UTF-8 text"),
	);
	expect(readPageDraft(draft, { pageId: "page", path: "missing.tsx" })).toEqual(
		Result.fail("The draft has no file missing.tsx"),
	);
});

it("applies replacements, writes and deletes in order", () => {
	const edited = edit([
		{ path: "client/page.tsx", oldText: "const a = 1;", newText: "const a = 2;" },
		{ path: "client/page.tsx", oldText: "= ", newText: "=  ", replaceAll: true },
		{ path: "client/util.ts", text: "export const $ = '$&';" },
		{ path: "client/image.bin", delete: true },
	]);
	assert(Result.isSuccess(edited));
	expect(decode(edited.success)).toEqual({
		"client/util.ts": "export const $ = '$&';",
		"client/page.tsx": "const a =  2;\nconst b =  1;\nexport default a;",
	});
});

it("names the first edit that cannot apply", () => {
	expect(edit([{ path: "client/page.tsx", oldText: "= 1;", newText: "= 2;" }])).toEqual(
		Result.fail(
			"Edit 1 (client/page.tsx): oldText occurs 2 times; include more surrounding text or set replaceAll",
		),
	);
	expect(
		edit([
			{ path: "client/page.tsx", oldText: "const a", newText: "let a" },
			{ path: "client/page.tsx", oldText: "const a", newText: "let a" },
		]),
	).toEqual(
		Result.fail("Edit 2 (client/page.tsx): oldText was not found; read the file again with page_read"),
	);
	expect(edit([{ path: "missing.tsx", delete: true }])).toEqual(
		Result.fail("Edit 1 (missing.tsx): the draft has no such file"),
	);
	expect(edit([{ path: "client/image.bin", oldText: "x", newText: "y" }])).toEqual(
		Result.fail("Edit 1 (client/image.bin): the file is not UTF-8 text"),
	);
});
