import { load } from "@ryot/sandbox-sdk/cheerio";

export const cleanHtmlDescription = (html: unknown) => {
	if (typeof html !== "string" || !html.trim()) {
		return null;
	}
	const $ = load(html);
	$("br").replaceWith("\n");
	return $.root().text().trim();
};
