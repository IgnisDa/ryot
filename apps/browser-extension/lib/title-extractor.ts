import type { ExtractedMetadata } from "./extension-types";

function extractTitle(): string {
	const title = document.title;
	const h1Elements = Array.from(document.querySelectorAll("h1")).map(
		(el) => el.textContent?.trim() || "",
	);

	if (h1Elements.length > 0 && h1Elements[0]) {
		return h1Elements[0];
	}

	return title || "Unknown";
}

export function extractMetadata(): ExtractedMetadata {
	const title = extractTitle();

	return {
		title,
		documentTitle: document.title,
	};
}
