import type { PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import {
	PAGE_READ_MAX_LINES,
	type PageEditInput,
	type PageReadInput,
} from "@ryot-app/contract/schema/agent-tool";
import { Result } from "effect";
import { Base64 } from "effect/encoding";

const utf8 = new TextDecoder("utf-8", { fatal: true });

const fileText = (content: string) =>
	Result.flatMap(Base64.decode(content), (bytes) =>
		Result.try({ catch: () => null, try: () => utf8.decode(bytes) }),
	).pipe(Result.getOrNull);

export const readPageDraft = (
	draft: {
		readonly name: string;
		readonly slug: string;
		readonly pageId: string;
		readonly draftRevision: number;
		readonly definition: PageDefinition;
	},
	input: PageReadInput,
): Result.Result<{ readonly [key: string]: unknown }, string> => {
	const { files, ...definition } = draft.definition;
	if (input.path == null) {
		return Result.succeed({
			...definition,
			name: draft.name,
			slug: draft.slug,
			pageId: draft.pageId,
			draftRevision: draft.draftRevision,
			files: files.map(({ path, content }) => ({
				path,
				lines: fileText(content)?.split("\n").length ?? null,
			})),
		});
	}
	const file = files.find(({ path }) => path === input.path);
	if (file === undefined) {
		return Result.fail(`The draft has no file ${input.path}`);
	}
	const text = fileText(file.content);
	if (text === null) {
		return Result.fail(`${input.path} is not UTF-8 text`);
	}
	const lines = text.split("\n");
	const start = input.offset ?? 1;
	const selected = lines.slice(start - 1, start - 1 + (input.limit ?? PAGE_READ_MAX_LINES));
	return Result.succeed({
		path: input.path,
		startLine: start,
		totalLines: lines.length,
		draftRevision: draft.draftRevision,
		endLine: start + selected.length - 1,
		text: selected.map((line, index) => `${start + index}: ${line}`).join("\n"),
	});
};

export const applyPageEdits = (
	definition: PageDefinition,
	input: PageEditInput,
): Result.Result<PageDefinition, string> => {
	const files = new Map(definition.files.map(({ path, content }) => [path, content]));
	for (const [index, change] of input.edits.entries()) {
		const label = `Edit ${index + 1} (${change.path})`;
		if ("delete" in change) {
			if (!files.delete(change.path)) {
				return Result.fail(`${label}: the draft has no such file`);
			}
		} else if ("text" in change) {
			files.set(change.path, Base64.encode(change.text));
		} else {
			const content = files.get(change.path);
			if (content === undefined) {
				return Result.fail(`${label}: the draft has no such file`);
			}
			const text = fileText(content);
			if (text === null) {
				return Result.fail(`${label}: the file is not UTF-8 text`);
			}
			const count = text.split(change.oldText).length - 1;
			if (count === 0) {
				return Result.fail(`${label}: oldText was not found; read the file again with page_read`);
			}
			if (count > 1 && change.replaceAll !== true) {
				return Result.fail(
					`${label}: oldText occurs ${count} times; include more surrounding text or set replaceAll`,
				);
			}
			files.set(change.path, Base64.encode(text.split(change.oldText).join(change.newText)));
		}
	}
	return Result.succeed({
		...definition,
		...(input.entry == null ? {} : { entry: input.entry }),
		...(input.queries == null ? {} : { queries: input.queries }),
		...(input.pluginQueries == null ? {} : { pluginQueries: input.pluginQueries }),
		...(input.pluginDependencies == null ? {} : { pluginDependencies: input.pluginDependencies }),
		files: [...files].map(([path, content]) => ({ path, content })),
	});
};
