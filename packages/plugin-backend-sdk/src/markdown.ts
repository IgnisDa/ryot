import type { Element, Root as HastRoot, RootContent as HastRootContent } from "hast";
import { raw } from "hast-util-raw";
import { toMdast } from "hast-util-to-mdast";
import type { BlockContent, Nodes, PhrasingContent, Root } from "mdast";
import { directiveFromMarkdown, directiveToMarkdown } from "mdast-util-directive";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toHast } from "mdast-util-to-hast";
import { toMarkdown } from "mdast-util-to-markdown";
import { directive } from "micromark-extension-directive";

const removedElements = new Set([
	"svg",
	"form",
	"audio",
	"embed",
	"input",
	"style",
	"track",
	"video",
	"button",
	"canvas",
	"iframe",
	"object",
	"script",
	"select",
	"source",
	"picture",
	"textarea",
]);

const cleanHtml = (node: Element | HastRoot): void => {
	node.children = node.children.filter(
		(child) => child.type !== "element" || !removedElements.has(child.tagName),
	);
	for (const child of node.children) {
		if (child.type === "element") {
			cleanHtml(child);
		}
	}
};

const htmlText = (node: HastRootContent): string => {
	if (node.type === "text") {
		return node.value;
	}
	if (node.type === "element") {
		if (node.tagName === "img") {
			return typeof node.properties["alt"] === "string" ? node.properties["alt"] : "";
		}
		return node.tagName === "br" ? "\n" : node.children.map(htmlText).join("");
	}
	return "";
};

const textContent = (value: string): PhrasingContent[] =>
	value === ""
		? []
		: value.split("\n").flatMap((line, index) => {
				const text: PhrasingContent = { value: line, type: "text" };
				return index === 0 ? [text] : [{ type: "break" }, text];
			});

const safeUrl = (value: string, baseUrl: string | undefined): string | undefined => {
	try {
		const url = /^[a-z][a-z0-9+.-]*:/i.test(value) ? new URL(value) : new URL(value, baseUrl);
		return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
	} catch {
		return undefined;
	}
};

const phrasing = (nodes: readonly Nodes[], baseUrl: string | undefined): PhrasingContent[] =>
	nodes.flatMap((node): PhrasingContent[] => {
		switch (node.type) {
			case "text":
			case "inlineCode":
				return textContent(node.value);
			case "code":
				return textContent(node.value.replace(/\n+$/, ""));
			case "link": {
				const children = phrasing(node.children, baseUrl);
				const url = safeUrl(node.url, baseUrl);
				return url === undefined || children.length === 0
					? children
					: [{ url, children, type: "link" }];
			}
			case "html":
			case "list":
			case "root":
			case "yaml":
			case "table":
			case "delete":
			case "heading":
			case "listItem":
			case "tableRow":
			case "paragraph":
			case "tableCell":
			case "blockquote":
			case "definition":
			case "leafDirective":
			case "linkReference":
			case "thematicBreak":
			case "footnoteReference":
			case "footnoteDefinition":
				return "children" in node ? phrasing(node.children, baseUrl) : [];
			case "break":
				return [{ type: "break" }];
			case "image":
			case "imageReference":
				return node.alt?.trim() ? textContent(node.alt) : [];
			case "strong":
			case "emphasis": {
				const children = phrasing(node.children, baseUrl);
				return children.length === 0 ? [] : [{ children, type: node.type }];
			}
			case "textDirective":
			case "containerDirective":
				return node.name === "spoiler"
					? [{ name: "spoiler", type: "textDirective", children: phrasing(node.children, baseUrl) }]
					: phrasing(node.children, baseUrl);
			default:
				return node;
		}
	});

const blocks = (nodes: readonly Nodes[], baseUrl: string | undefined): BlockContent[] =>
	nodes.flatMap((node): BlockContent[] => {
		switch (node.type) {
			case "code":
			case "paragraph": {
				const children = phrasing([node], baseUrl);
				return children.some((child) => child.type !== "text" || child.value.length > 0)
					? [{ children, type: "paragraph" }]
					: [];
			}
			case "list":
				return [
					{
						type: "list",
						spread: false,
						ordered: node.ordered === true,
						start: node.ordered ? (node.start ?? 1) : null,
						children: node.children.map((item) => ({
							spread: false,
							type: "listItem",
							children: blocks(item.children, baseUrl),
						})),
					},
				];
			case "root":
			case "listItem":
				return blocks(node.children, baseUrl);
			case "link":
			case "text":
			case "yaml":
			case "break":
			case "image":
			case "table":
			case "delete":
			case "strong":
			case "emphasis":
			case "tableRow":
			case "tableCell":
			case "inlineCode":
			case "leafDirective":
			case "linkReference":
			case "textDirective":
			case "imageReference":
			case "footnoteReference":
			case "footnoteDefinition": {
				const children = phrasing([node], baseUrl);
				return children.length === 0 ? [] : [{ children, type: "paragraph" }];
			}
			case "html":
			case "definition":
			case "thematicBreak":
				return [];
			case "heading": {
				const children = phrasing(node.children, baseUrl);
				return children.length === 0
					? []
					: [{ type: "paragraph", children: [{ children, type: "strong" }] }];
			}
			case "blockquote":
				return [{ type: "blockquote", children: blocks(node.children, baseUrl) }];
			case "containerDirective":
				return node.name === "spoiler"
					? [
							{
								name: "spoiler",
								type: "containerDirective",
								children: blocks(node.children, baseUrl),
							},
						]
					: blocks(node.children, baseUrl);
			default:
				return node;
		}
	});

export const normalizeMarkdown = (input: string, options?: { baseUrl?: string }): string => {
	const parsed = fromMarkdown(input, {
		extensions: [directive()],
		mdastExtensions: [directiveFromMarkdown()],
	});
	const hast = raw(
		toHast(parsed, {
			allowDangerousHtml: true,
			handlers: {
				leafDirective: (state, node) => state.all(node),
				textDirective: (state, node) =>
					node.name === "spoiler"
						? {
								type: "element",
								tagName: "span",
								children: state.all(node),
								properties: { dataRyotSpoiler: "inline" },
							}
						: state.all(node),
				containerDirective: (state, node) =>
					node.name === "spoiler"
						? {
								tagName: "div",
								type: "element",
								children: state.all(node),
								properties: { dataRyotSpoiler: "block" },
							}
						: state.all(node),
			},
		}),
	);
	if (hast.type === "root" || hast.type === "element") {
		cleanHtml(hast);
	}
	const converted = toMdast(hast, {
		document: true,
		handlers: {
			u: (state, node) => state.all(node),
			span: (state, node) =>
				node.properties["dataRyotSpoiler"] === "inline"
					? {
							name: "spoiler",
							type: "textDirective",
							children: phrasing(state.all(node), options?.baseUrl),
						}
					: state.all(node),
			pre: (_state, node) => ({
				type: "paragraph",
				children: textContent(
					htmlText(node)
						.split("\n")
						.map((line) => line.replace(/[ \t\f\r]+/g, " ").trim())
						.join("\n")
						.replace(/^\n+|\n+$/g, ""),
				),
			}),
			div: (state, node) =>
				node.properties["dataRyotSpoiler"] === "block"
					? {
							name: "spoiler",
							type: "containerDirective",
							children: blocks(state.toFlow(state.all(node)), options?.baseUrl),
						}
					: state.toFlow(state.all(node)),
			table: (state, node) => {
				const rows: BlockContent[] = [];
				const collectRows = (element: Element): void => {
					if (element.tagName === "caption") {
						rows.push(...blocks(state.toFlow(state.all(element)), options?.baseUrl));
					} else if (element.tagName === "tr") {
						rows.push({
							type: "paragraph",
							children: element.children
								.filter(
									(child): child is Element =>
										child.type === "element" && (child.tagName === "td" || child.tagName === "th"),
								)
								.flatMap((cell, index): PhrasingContent[] => {
									const children = phrasing(state.all(cell), options?.baseUrl);
									return index === 0 ? children : textContent(" | ").concat(children);
								}),
						});
					} else {
						for (const child of element.children) {
							if (child.type === "element") {
								collectRows(child);
							}
						}
					}
				};
				collectRows(node);
				return rows;
			},
		},
	});
	const canonical: Root = { type: "root", children: blocks([converted], options?.baseUrl) };
	return toMarkdown(canonical, {
		bullet: "-",
		strong: "*",
		emphasis: "*",
		extensions: [directiveToMarkdown()],
	}).replace(/\n$/, "");
};
