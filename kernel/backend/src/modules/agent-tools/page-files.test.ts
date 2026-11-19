import { expect, it } from "bun:test";

import type { PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import type { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
const draft = { definition, name: "Page", slug: "page", pageId: "page", draftRevision: 3 };
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
				{ lines: 3, path: "client/page.tsx" },
				{ lines: null, path: "client/image.bin" },
			],
		}),
	);
	expect(
		readPageDraft(draft, { limit: 1, offset: 2, pageId: "page", path: "client/page.tsx" }),
	).toEqual(
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
		Result.fail(
			kernelMessage("error.agent-tools.page-file-not-text", { path: "client/image.bin" }),
		),
	);
	expect(readPageDraft(draft, { pageId: "page", path: "missing.tsx" })).toEqual(
		Result.fail(kernelMessage("error.agent-tools.page-file-not-found", { path: "missing.tsx" })),
	);
});

it("applies replacements, writes and deletes in order", () => {
	const edited = edit([
		{ path: "client/page.tsx", oldText: "const a = 1;", newText: "const a = 2;" },
		{ oldText: "= ", newText: "=  ", replaceAll: true, path: "client/page.tsx" },
		{ path: "client/util.ts", text: "export const $ = '$&';" },
		{ delete: true, path: "client/image.bin" },
	]);
	assert(Result.isSuccess(edited));
	expect(decode(edited.success)).toEqual({
		"client/util.ts": "export const $ = '$&';",
		"client/page.tsx": "const a =  2;\nconst b =  1;\nexport default a;",
	});
});

const editFailed = (position: number, path: string, problem: Message) =>
	Result.fail(
		kernelMessage("error.agent-tools.page-edit-failed", { path, problem, edit: position }),
	);

it("names the first edit that cannot apply", () => {
	expect(edit([{ oldText: "= 1;", newText: "= 2;", path: "client/page.tsx" }])).toEqual(
		editFailed(
			1,
			"client/page.tsx",
			kernelMessage("error.agent-tools.page-edit-text-ambiguous", { count: 2 }),
		),
	);
	expect(
		edit([
			{ newText: "let a", oldText: "const a", path: "client/page.tsx" },
			{ newText: "let a", oldText: "const a", path: "client/page.tsx" },
		]),
	).toEqual(
		editFailed(2, "client/page.tsx", kernelMessage("error.agent-tools.page-edit-text-not-found")),
	);
	expect(edit([{ delete: true, path: "missing.tsx" }])).toEqual(
		editFailed(
			1,
			"missing.tsx",
			kernelMessage("error.agent-tools.page-file-not-found", { path: "missing.tsx" }),
		),
	);
	expect(edit([{ oldText: "x", newText: "y", path: "client/image.bin" }])).toEqual(
		editFailed(
			1,
			"client/image.bin",
			kernelMessage("error.agent-tools.page-file-not-text", { path: "client/image.bin" }),
		),
	);
});
