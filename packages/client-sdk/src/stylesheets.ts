const stylesheetPromisesByUrl = new Map<string, Promise<void>>();

export const loadStylesheet = (href: string): Promise<void> => {
	const cached = stylesheetPromisesByUrl.get(href);
	if (cached) {
		return cached;
	}
	const existing = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].find(
		(link) =>
			link.getAttribute("href") === href || link.href === new URL(href, document.baseURI).href,
	);
	if (existing?.sheet) {
		return Promise.resolve();
	}
	const link = existing ?? document.createElement("link");
	const loaded = new Promise<void>((resolve, reject) => {
		const failure = () => reject(new Error(`Client stylesheet failed to load: ${href}`));
		link.addEventListener("load", () => resolve(), { once: true });
		link.addEventListener("error", failure, { once: true });
		if (existing) {
			const checkSettled = () => {
				if (existing.sheet) {
					resolve();
				} else {
					failure();
				}
			};
			if (document.readyState === "complete") {
				queueMicrotask(checkSettled);
			} else {
				window.addEventListener("load", checkSettled, { once: true });
			}
		}
	});
	stylesheetPromisesByUrl.set(href, loaded);
	if (!existing) {
		link.rel = "stylesheet";
		link.href = href;
		document.head.append(link);
	}
	return loaded;
};
