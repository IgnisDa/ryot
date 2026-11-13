import { HttpUrl } from "@ryot-app/contract/schema/utils";
import { Schema } from "effect";
import type { Nodes, Root } from "mdast";
import { directiveFromMarkdown } from "mdast-util-directive";
import { fromMarkdown } from "mdast-util-from-markdown";
import { directive } from "micromark-extension-directive";
import { createContext, type ReactNode, useContext, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";

const isHttpUrl = Schema.is(HttpUrl);
const MarkdownLinkCallback = createContext<(url: string) => void>(() => undefined);

const containsSpoiler = (node: Nodes): boolean =>
	((node.type === "textDirective" ||
		node.type === "leafDirective" ||
		node.type === "containerDirective") &&
		node.name === "spoiler") ||
	("children" in node && node.children.some(containsSpoiler));

const visitDirectives = (node: Nodes): void => {
	if (node.type === "link" && containsSpoiler(node)) {
		node.data = { hName: "span" };
	}
	if (
		node.type === "textDirective" ||
		node.type === "leafDirective" ||
		node.type === "containerDirective"
	) {
		let hName = "div";
		if (node.type === "textDirective") {
			hName = "span";
		} else if (node.name === "spoiler") {
			hName = "details";
		}
		node.data = { hName, hProperties: node.name === "spoiler" ? { "data-spoiler": true } : {} };
	}
	if ("children" in node) {
		for (const child of node.children) {
			visitDirectives(child);
		}
	}
};

function transformDirectives() {
	return (tree: Root) => visitDirectives(tree);
}

const previewMarkdown = (node: Nodes): string => {
	if (
		(node.type === "textDirective" ||
			node.type === "leafDirective" ||
			node.type === "containerDirective") &&
		node.name === "spoiler"
	) {
		return "";
	}
	if (node.type === "html") {
		return "";
	}
	if (node.type === "break") {
		return " ";
	}
	if ("children" in node) {
		const inline =
			node.type === "paragraph" ||
			node.type === "emphasis" ||
			node.type === "strong" ||
			node.type === "link" ||
			node.type === "textDirective";
		return node.children.map(previewMarkdown).join(inline ? "" : " ");
	}
	if ("value" in node) {
		return node.value;
	}
	if (node.type === "image") {
		return node.alt ?? "";
	}
	return "";
};

export function markdownPlainText(text: string): string {
	const tree = fromMarkdown(text, {
		extensions: [directive()],
		mdastExtensions: [directiveFromMarkdown()],
	});
	return previewMarkdown(tree).replaceAll(/\s+/g, " ").trim();
}

function InlineSpoiler(props: { readonly children: ReactNode }) {
	const [revealed, setRevealed] = useState(false);
	return (
		<span>
			<button
				type="button"
				aria-expanded={revealed}
				onClick={() => setRevealed(!revealed)}
				className="rounded border border-border bg-surface-2 px-1 text-text-muted"
			>
				{revealed ? "Hide spoiler" : "Show spoiler"}
			</button>
			<span hidden={!revealed}>{props.children}</span>
		</span>
	);
}

const MarkdownLink: NonNullable<Components["a"]> = ({ href, children }) => {
	const onOpenLink = useContext(MarkdownLinkCallback);
	if (!href || !isHttpUrl(href)) {
		return children;
	}
	return (
		<a
			href={href}
			className="text-accent-text underline"
			onClick={(event) => {
				event.preventDefault();
				onOpenLink(href);
			}}
			onAuxClick={(event) => {
				event.preventDefault();
				if (event.button === 1) {
					onOpenLink(href);
				}
			}}
		>
			{children}
		</a>
	);
};

const markdownComponents: Components = {
	a: MarkdownLink,
	div: ({ children }) => <div>{children}</div>,
	p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
	ul: ({ children }) => <ul className="mb-2 list-disc pl-5">{children}</ul>,
	ol: ({ start, children }) => (
		<ol start={start} className="mb-2 list-decimal pl-5">
			{children}
		</ol>
	),
	blockquote: ({ children }) => (
		<blockquote className="mb-2 border-l-2 border-border pl-3 text-text-muted">
			{children}
		</blockquote>
	),
	span: ({ node, children }) =>
		node?.properties["data-spoiler"] ? (
			<InlineSpoiler>{children}</InlineSpoiler>
		) : (
			<span>{children}</span>
		),
	details: ({ children }) => (
		<details className="mb-2 rounded border border-border p-2">
			<summary className="cursor-pointer text-text-muted">Show spoiler</summary>
			{children}
		</details>
	),
};

const basicElements = [
	"p",
	"strong",
	"em",
	"ul",
	"ol",
	"li",
	"blockquote",
	"br",
	"a",
	"span",
	"div",
	"details",
];

export function MarkdownContent(props: {
	readonly text: string;
	readonly onOpenLink: (url: string) => void;
}) {
	return (
		<MarkdownLinkCallback.Provider value={props.onOpenLink}>
			<Markdown
				skipHtml
				unwrapDisallowed
				components={markdownComponents}
				allowedElements={basicElements}
				urlTransform={(url) => (isHttpUrl(url) ? url : "")}
				remarkPlugins={[remarkDirective, transformDirectives]}
			>
				{props.text}
			</Markdown>
		</MarkdownLinkCallback.Provider>
	);
}

const heading = "mt-4 mb-2 font-semibold text-text first:mt-0";
const documentComponents: Components = {
	...markdownComponents,
	del: ({ children }) => <del>{children}</del>,
	hr: () => <hr className="my-4 border-border" />,
	h3: ({ children }) => <h4 className={`${heading} text-body`}>{children}</h4>,
	h4: ({ children }) => <h5 className={`${heading} text-body`}>{children}</h5>,
	h1: ({ children }) => <h3 className={`${heading} text-heading`}>{children}</h3>,
	h2: ({ children }) => <h3 className={`${heading} text-heading`}>{children}</h3>,
	td: ({ children }) => <td className="border-b border-border px-2 py-1.5">{children}</td>,
	code: ({ children }) => (
		<code className="rounded-sm bg-surface-2 px-1 py-px font-mono text-[0.9em]">{children}</code>
	),
	th: ({ children }) => (
		<th className="border-b border-border-emphasis px-2 py-1.5 text-left font-medium text-text-subtle">
			{children}
		</th>
	),
	table: ({ children }) => (
		<div className="mb-2 overflow-x-auto">
			<table className="w-full border-collapse text-label tabular-nums">{children}</table>
		</div>
	),
	pre: ({ children }) => (
		<pre className="mb-2 overflow-x-auto rounded-md bg-surface-2 p-3 font-mono text-label [&_code]:bg-transparent [&_code]:p-0">
			{children}
		</pre>
	),
};

export function MarkdownDocument(props: {
	readonly text: string;
	readonly onOpenLink: (url: string) => void;
}) {
	return (
		<MarkdownLinkCallback.Provider value={props.onOpenLink}>
			<Markdown
				skipHtml
				unwrapDisallowed
				remarkPlugins={[remarkGfm]}
				components={documentComponents}
				urlTransform={(url) => (isHttpUrl(url) ? url : "")}
				allowedElements={[
					...basicElements,
					"h1",
					"h2",
					"h3",
					"h4",
					"hr",
					"del",
					"code",
					"pre",
					"table",
					"thead",
					"tbody",
					"tr",
					"th",
					"td",
				]}
			>
				{props.text}
			</Markdown>
		</MarkdownLinkCallback.Provider>
	);
}
