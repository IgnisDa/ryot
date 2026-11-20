import sanitizeHtml from "sanitize-html";

export const sanitizeRichText = (html: string) =>
	sanitizeHtml(html, {
		parseStyleAttributes: false,
		allowProtocolRelative: false,
		allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
		allowedSchemes: ["http", "https", "mailto", "tel"],
		allowedSchemesByTag: { img: ["http", "https"] },
		allowedAttributes: {
			a: ["href", "title"],
			img: ["src", "alt", "title", "width", "height", "loading"],
		},
	});
