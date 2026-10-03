import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { MediaSandboxError } from "./failures";
import { normalizeRichDescription } from "./rich-description";

const escapeHtml = (text: string): string =>
	text.replace(/[&<>"']/g, (character) => {
		switch (character) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&#39;";
		}
	});

const literalHtml = (text: string): string => escapeHtml(text).replace(/\n/g, "<br>");

const linkHtml = (url: string, label: string): string =>
	`<a href="${escapeHtml(url)}">${label}</a>`;

const wrapInlineHtml = (body: string, opening: string, closing: string): string => {
	const blocks = /<\/?(?:div|blockquote)\b[^>]*>/g;
	let html = "";
	let offset = 0;
	let depth = 0;
	let contentStart = 0;
	let blockOpening = "";
	for (const match of body.matchAll(blocks)) {
		if (!match[0].startsWith("</")) {
			if (depth === 0) {
				const inline = body.slice(offset, match.index);
				html += inline ? opening + inline + closing : "";
				blockOpening = match[0];
				contentStart = match.index + match[0].length;
			}
			depth += 1;
		} else {
			depth -= 1;
			if (depth === 0) {
				html +=
					blockOpening +
					wrapInlineHtml(body.slice(contentStart, match.index), opening, closing) +
					match[0];
				offset = match.index + match[0].length;
			}
		}
	}
	const inline = body.slice(offset);
	return html + (inline ? opening + inline + closing : "");
};

const textHtml = (text: string, inLink: boolean): string => {
	if (inLink) {
		return literalHtml(text);
	}
	const tokens = /https?:\/\/[^\s<>[\]]+|\b[cdprsuv]\d+(?:\.\d+)?\b/g;
	let html = "";
	let offset = 0;
	for (const match of text.matchAll(tokens)) {
		html += literalHtml(text.slice(offset, match.index));
		const token = match[0];
		const url = token.startsWith("http") ? token.replace(/[.,!?;:)]+$/, "") : token;
		html += linkHtml(token.startsWith("http") ? url : `https://vndb.org/${url}`, literalHtml(url));
		html += literalHtml(token.slice(url.length));
		offset = match.index + token.length;
	}
	return html + literalHtml(text.slice(offset));
};

interface Frame {
	body: string;
	inLink: boolean;
	opening: string;
	start: number;
	tag: string;
	url: string;
}

const frameHtml = (frame: Frame, source: string, end: number, closed: boolean): string => {
	if (!closed && frame.tag !== "spoiler") {
		return literalHtml(frame.opening) + frame.body;
	}
	switch (frame.tag) {
		case "b":
			return wrapInlineHtml(frame.body, "<strong>", "</strong>");
		case "i":
			return wrapInlineHtml(frame.body, "<em>", "</em>");
		case "u":
		case "s":
			return frame.body;
		case "quote":
			return `<blockquote>${frame.body}</blockquote>`;
		case "url":
			return wrapInlineHtml(frame.body, `<a href="${escapeHtml(frame.url)}">`, "</a>");
		case "spoiler": {
			const block = /\n[ \t]*\n/.test(source.slice(frame.start, end));
			const element = block ? "div" : "span";
			return `<${element} data-ryot-spoiler="${block ? "block" : "inline"}">${frame.body}</${element}>`;
		}
		default:
			return frame.body;
	}
};

const vndbHtml = (source: string): string => {
	const root: Frame = { tag: "", url: "", body: "", start: 0, opening: "", inLink: false };
	const stack = [root];
	const tokens = /\[[^\]\n]*\]/g;
	let offset = 0;
	let current = root;
	for (let match = tokens.exec(source); match; match = tokens.exec(source)) {
		current.body += textHtml(source.slice(offset, match.index), current.inLink);
		const token = match[0];
		offset = tokens.lastIndex;
		if (token === `[/${current.tag}]` && stack.length > 1) {
			stack.pop();
			const parent = stack[stack.length - 1];
			if (parent) {
				parent.body += frameHtml(current, source, match.index, true);
				current = parent;
			}
		} else if (token === "[raw]") {
			const end = source.indexOf("[/raw]", offset);
			current.body += literalHtml(
				(end < 0 ? token : "") + source.slice(offset, end < 0 ? source.length : end),
			);
			offset = end < 0 ? source.length : end + "[/raw]".length;
			tokens.lastIndex = offset;
		} else if (/^\[(?:b|i|u|s|spoiler|quote)\]$/.test(token) || token.startsWith("[url=")) {
			const tag = token.startsWith("[url=") ? "url" : token.slice(1, -1);
			if (tag === "url" && current.inLink) {
				current.body += literalHtml(token);
				continue;
			}
			current = {
				tag,
				body: "",
				start: offset,
				opening: token,
				inLink: current.inLink || tag === "url",
				url: tag === "url" ? token.slice(5, -1) : "",
			};
			stack.push(current);
		} else {
			current.body += literalHtml(token);
		}
	}
	current.body += textHtml(source.slice(offset), current.inLink);
	while (stack.length > 1) {
		stack.pop();
		const parent = stack[stack.length - 1];
		if (parent) {
			parent.body += frameHtml(current, source, source.length, false);
			current = parent;
		}
	}
	return `<div>${root.body}</div>`;
};

export const normalizeVndbDescription = Effect.fn("normalizeVndbDescription")(function* (
	input: unknown,
	baseUrl?: string,
): Effect.fn.Return<string | null, MediaSandboxError> {
	if (typeof input !== "string" || !input.trim()) {
		return null;
	}
	const html = yield* Effect.try({
		try: () => vndbHtml(input.trim().replace(/\r\n?/g, "\n")),
		catch: () => new MediaSandboxError({ message: "description conversion failed" }),
	});
	return yield* normalizeRichDescription(html, baseUrl);
});
