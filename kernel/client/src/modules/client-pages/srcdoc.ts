import {
	CLIENT_COMPOSITION_METADATA_ELEMENT_ID,
	CLIENT_PAGE_ROOT_ELEMENT_ID,
} from "@ryot-app/client-plugin-contract";
import type { ClientCompositionDocument } from "@ryot-app/contract/modules/client-pages/schemas";

import type { ServerOrigin } from "#/api/origin";

const escapeHtml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
const htmlJson = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");

// A srcdoc document inherits the host's policy container, so this meta tag is its only
// referrer control and must precede every resource the document can request.
export const renderClientDocument = (
	document: ClientCompositionDocument,
	serverUrl: ServerOrigin,
) => {
	const links = [
		...document.modulepreloads.map(
			(href) => `<link rel="modulepreload" href="${escapeHtml(href)}" />`,
		),
		...document.stylesheets.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}" />`),
		...document.preloads.map(
			({ as, href, type }) =>
				`<link rel="preload" href="${escapeHtml(href)}" as="${as}" type="${escapeHtml(type)}"${as === "image" ? "" : ' crossorigin="anonymous"'} />`,
		),
	].join("\n\t\t");
	return `<!doctype html>
<html lang="en">
	<head>
		<base href="${escapeHtml(`${serverUrl}/`)}" />
		<meta name="referrer" content="no-referrer" />
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${escapeHtml(document.title)}</title>
		<script type="importmap" id="ryot-client-importmap">${htmlJson(document.importMap)}</script>
		${links}
		<script type="application/json" id="${CLIENT_COMPOSITION_METADATA_ELEMENT_ID}">${htmlJson(document.metadata)}</script>
		<script type="application/json" id="ryot-client-composition">${htmlJson(document.descriptor)}</script>
	</head>
	<body>
		<div id="${CLIENT_PAGE_ROOT_ELEMENT_ID}"></div>
		<script type="module" src="${escapeHtml(document.bootstrap)}"></script>
	</body>
</html>
`;
};
