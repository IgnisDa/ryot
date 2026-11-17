import type { PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import {
	PAGE_READ_MAX_LINES,
	type PageEditInput,
	type PageReadInput,
} from "@ryot-app/contract/schema/agent-tool";
import type { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
): Result.Result<{ readonly [key: string]: unknown }, Message> => {
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
		return Result.fail(
			kernelMessage("error.agent-tools.page-file-not-found", { path: input.path }),
		);
	}
	const text = fileText(file.content);
	if (text === null) {
		return Result.fail(kernelMessage("error.agent-tools.page-file-not-text", { path: input.path }));
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
): Result.Result<PageDefinition, Message> => {
	const files = new Map(definition.files.map(({ path, content }) => [path, content]));
	for (const [index, change] of input.edits.entries()) {
		const failed = (problem: Message) =>
			Result.fail(
				kernelMessage("error.agent-tools.page-edit-failed", {
					problem,
					edit: index + 1,
					path: change.path,
				}),
			);
		if ("delete" in change) {
			if (!files.delete(change.path)) {
				return failed(
					kernelMessage("error.agent-tools.page-file-not-found", { path: change.path }),
				);
			}
		} else if ("text" in change) {
			files.set(change.path, Base64.encode(change.text));
		} else {
			const content = files.get(change.path);
			if (content === undefined) {
				return failed(
					kernelMessage("error.agent-tools.page-file-not-found", { path: change.path }),
				);
			}
			const text = fileText(content);
			if (text === null) {
				return failed(kernelMessage("error.agent-tools.page-file-not-text", { path: change.path }));
			}
			const count = text.split(change.oldText).length - 1;
			if (count === 0) {
				return failed(kernelMessage("error.agent-tools.page-edit-text-not-found"));
			}
			if (count > 1 && change.replaceAll !== true) {
				return failed(kernelMessage("error.agent-tools.page-edit-text-ambiguous", { count }));
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
