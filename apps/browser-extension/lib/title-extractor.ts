export interface ExtractedMetadata {
	title: string;
	year?: string;
	season?: number;
	episode?: number;
	episodeTitle?: string;
	documentTitle: string;
	h1Elements: string[];
	dataAttributes: Record<string, string>;
}

export function extractTitle(): string {
	const title = document.title;
	const h1Elements = Array.from(document.querySelectorAll("h1")).map(
		(el) => el.textContent?.trim() || "",
	);

	if (h1Elements.length > 0 && h1Elements[0]) {
		return h1Elements[0];
	}

	return title || "Unknown";
}

export function extractDataAttributes(): Record<string, string> {
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

export function extractSiteSpecificMetadata(
	domain: string,
): Partial<ExtractedMetadata> {
	switch (domain) {
		case "netflix.com":
			return extractNetflixMetadata();
		case "youtube.com":
			return extractYouTubeMetadata();
		case "primevideo.com":
			return extractPrimeVideoMetadata();
		default:
			return {};
	}
}

function extractNetflixMetadata(): Partial<ExtractedMetadata> {
	const metadata: Partial<ExtractedMetadata> = {};

	const titleElement = document.querySelector('[data-uia="video-title"]');
	if (titleElement) {
		const title = titleElement.textContent?.trim() || "";
		metadata.title = title;
	}

	return metadata;
}

function extractYouTubeMetadata(): Partial<ExtractedMetadata> {
	const metadata: Partial<ExtractedMetadata> = {};

	const titleElement = document.querySelector("h1.title yt-formatted-string");
	if (titleElement) {
		const title = titleElement.textContent?.trim() || "";
		metadata.title = title;
	}

	return metadata;
}

function extractPrimeVideoMetadata(): Partial<ExtractedMetadata> {
	const metadata: Partial<ExtractedMetadata> = {};

	const titleElement = document.querySelector('[data-automation-id="title"]');
	if (titleElement) {
		const title = titleElement.textContent?.trim() || "";
		metadata.title = title;
	}

	return metadata;
}
