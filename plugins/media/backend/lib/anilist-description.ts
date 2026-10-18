import { load } from "@ryot-app/plugin-backend-sdk/cheerio";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import { MediaSandboxError } from "./failures";
import { normalizeRichDescription } from "./rich-description";

interface SpoilerFrame {
	body: string;
	start: number;
}

const spoilerHtml = (frame: SpoilerFrame, source: string, end: number): string => {
	const block =
		/\n[ \t]*\n|<\/?(?:address|article|aside|blockquote|body|caption|center|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hgroup|hr|html|legend|li|listing|main|menu|nav|ol|p|plaintext|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)\b/i.test(
			source.slice(frame.start, end) + frame.body,
		);
	if (!block) {
		return `<span data-ryot-spoiler="inline">${frame.body}</span>`;
	}
	const formatting: string[] = [];
	for (const match of source.slice(0, frame.start).matchAll(/<\/?(?:strong|em|b|i|a)\b[^>]*>/gi)) {
		if (match[0].startsWith("</")) {
			formatting.pop();
		} else {
			formatting.push(match[0]);
		}
	}
	const closing = formatting.reduce(
		(result, tag) => tag.replace(/<([a-z]+)[\s\S]*/i, "</$1>") + result,
		"",
	);
	return `${closing}\n\n<div data-ryot-spoiler="block">\n\n${frame.body}\n\n</div>\n\n${formatting.join("")}`;
};

const legacySpoilerHtml = (source: string): string => {
	const root: SpoilerFrame = { body: "", start: 0 };
	const stack = [root];
	let current = root;
	let offset = 0;
	for (const match of source.matchAll(/~!|!~/g)) {
		current.body += source.slice(offset, match.index);
		offset = match.index + match[0].length;
		if (match[0] === "~!") {
			current = { body: "", start: offset };
			stack.push(current);
		} else if (stack.length > 1) {
			stack.pop();
			const parent = stack[stack.length - 1];
			if (parent) {
				parent.body += spoilerHtml(current, source, match.index);
				current = parent;
			}
		} else {
			current.body += match[0];
		}
	}
	current.body += source.slice(offset);
	while (stack.length > 1) {
		stack.pop();
		const parent = stack[stack.length - 1];
		if (parent) {
			parent.body += spoilerHtml(current, source, source.length);
			current = parent;
		}
	}
	return root.body;
};

const nativeSpoilerHtml = (source: string): string => {
	const fragment = load(source, { sourceCodeLocationInfo: true }, false);
	const spoilers = fragment(".markdown_spoiler")
		.filter((_index, element) => fragment(element).parents(".markdown_spoiler").length === 0)
		.toArray()
		.sort(
			(left, right) =>
				(left.sourceCodeLocation?.startOffset ?? 0) - (right.sourceCodeLocation?.startOffset ?? 0),
		);
	let html = "";
	let offset = 0;
	for (const spoiler of spoilers) {
		const location = spoiler.sourceCodeLocation;
		if (!location?.startTag) {
			throw new Error("AniList spoiler source location is missing");
		}
		if (location.startOffset < offset) {
			continue;
		}
		const start = location.startTag.endOffset;
		const end = location.endTag?.startOffset ?? source.length;
		html += source.slice(offset, location.startOffset);
		html += spoilerHtml(
			{ start, body: legacySpoilerHtml(nativeSpoilerHtml(source.slice(start, end))) },
			source,
			end,
		);
		offset = location.endTag?.endOffset ?? source.length;
	}
	return html + source.slice(offset);
};

export const normalizeAnilistDescription = Effect.fn("normalizeAnilistDescription")(function* (
	input: unknown,
	baseUrl?: string,
): Effect.fn.Return<null | string, MediaSandboxError> {
	if (typeof input !== "string" || !input.trim()) {
		return null;
	}
	const html = yield* Effect.try({
		catch: () => new MediaSandboxError({ message: "description conversion failed" }),
		try: () => legacySpoilerHtml(nativeSpoilerHtml(input.trim().replace(/\r\n?/g, "\n"))),
	});
	return yield* normalizeRichDescription(html, baseUrl);
});
