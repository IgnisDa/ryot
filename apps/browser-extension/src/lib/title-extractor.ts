export function extractTitle() {
	const title = document.title;
	const h1Elements = Array.from(document.querySelectorAll("h1")).map(
		(el) => el.textContent?.trim() || "",
	);

	if (h1Elements.length > 0 && h1Elements[0]) {
		return h1Elements[0];
	}

	if (!title || title === "Unknown") {
		return null;
	}

	return title;
}
