import type { ExtractedMetadata } from "../types/progress";

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

function extractDataAttributes(): Record<string, string> {
	const attributes: Record<string, string> = {};
	const elementsWithData = document.querySelectorAll(
		"[data-title], [data-video-title], [data-name]",
	);

	for (const el of elementsWithData) {
		for (const attr of el.attributes) {
			if (attr.name.startsWith("data-")) {
				attributes[attr.name] = attr.value;
			}
		}
	}

	return attributes;
}

export function extractMetadata(): ExtractedMetadata {
	const title = extractTitle();
	const h1Elements = Array.from(document.querySelectorAll("h1")).map(
		(el) => el.textContent?.trim() || "",
	);
	const dataAttributes = extractDataAttributes();

	return {
		title,
		documentTitle: document.title,
		h1Elements,
		dataAttributes,
	};
}
