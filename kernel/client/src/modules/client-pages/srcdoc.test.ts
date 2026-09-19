import type { ClientCompositionDocument } from "@ryot-app/contract/modules/client-pages/schemas";
import { expect, it } from "vitest";

import { decodeServerOrigin } from "#/api/origin";

import { renderClientDocument } from "./srcdoc";

const asset = (file: string) => `/api/client-assets/${"a".repeat(64)}/public/${file}`;

const document: ClientCompositionDocument = {
	title: "Page",
	bootstrap: asset("bootstrap.js"),
	stylesheets: [asset("page.css")],
	modulepreloads: [asset("module.js")],
	importMap: { imports: { "@ryot-app/client-sdk": asset("runtime.js") } },
	metadata: { format: 1, apiVersion: 1, bridgeVersion: 1, compilerVersion: 1, hash: "composition" },
	preloads: [
		{ as: "font", type: "font/woff2", href: asset("font.woff2") },
		{ as: "image", type: "image/svg+xml", href: asset("icon.svg") },
	],
	descriptor: {
		application: "page",
		automaticRegistry: [
			{
				layout: "grid",
				entitySchemaSlug: "entity",
				ownerPluginId: "presentation-id",
				stylesheets: [asset("card.css")],
				module: { binding: "card", specifier: "@ryot-app/plugins/presentation/card" },
			},
		],
	},
};

const server = decodeServerOrigin("http://192.168.1.5:3000");

it("puts the server base and referrer policy before every resource", () => {
	const html = renderClientDocument(document, server);
	const base = html.indexOf('<base href="http://192.168.1.5:3000/" />');
	const referrer = html.indexOf('<meta name="referrer" content="no-referrer" />');
	expect(html.indexOf("<head>")).toBeLessThan(base);
	expect(html.slice(html.indexOf("<head>") + "<head>".length, base).trim()).toBe("");
	expect(html.slice(base, referrer)).toBe('<base href="http://192.168.1.5:3000/" />\n\t\t');
	for (const resource of ["<script", "<link", "<title>"]) {
		expect(referrer).toBeLessThan(html.indexOf(resource));
	}
	expect(html.match(/<base /g)).toHaveLength(1);
});

it("renders the import map, preload plan, metadata, descriptor, and bootstrap", () => {
	const html = renderClientDocument(document, server);
	expect(html.indexOf('<script type="importmap"')).toBeLessThan(
		html.indexOf('<link rel="modulepreload"'),
	);
	expect(html).toContain(
		`<script type="importmap" id="ryot-client-importmap">{"imports":{"@ryot-app/client-sdk":"${asset("runtime.js")}"}}</script>`,
	);
	expect(html).toContain(`<link rel="modulepreload" href="${asset("module.js")}" />`);
	expect(html).toContain(`<link rel="stylesheet" href="${asset("page.css")}" />`);
	expect(html).toContain(
		`<link rel="preload" href="${asset("font.woff2")}" as="font" type="font/woff2" crossorigin="anonymous" />`,
	);
	expect(html).toContain(
		`<link rel="preload" href="${asset("icon.svg")}" as="image" type="image/svg+xml" />`,
	);
	expect(html).toContain('"hash":"composition"');
	expect(html).toContain(`"stylesheets":["${asset("card.css")}"]`);
	expect(html).not.toContain(`<link rel="stylesheet" href="${asset("card.css")}"`);
	expect(html).toContain(`<script type="module" src="${asset("bootstrap.js")}"></script>`);
	expect(renderClientDocument(document, server)).toBe(html);
});

it("escapes document text, attributes, and embedded JSON", () => {
	const html = renderClientDocument(
		{
			...document,
			title: '</title><script>alert("x")</script>',
			bootstrap: '/boot.js"><script>alert(1)</script>',
			importMap: { imports: { "</script><script>alert(1)</script>": "/x.js" } },
		},
		server,
	);
	expect(html).toContain(
		"<title>&lt;/title&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</title>",
	);
	expect(html).toContain('src="/boot.js&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"></script>');
	expect(html).toContain("\\u003c/script>\\u003cscript>alert(1)\\u003c/script>");
	expect(html.match(/<script/g)).toHaveLength(4);
});
