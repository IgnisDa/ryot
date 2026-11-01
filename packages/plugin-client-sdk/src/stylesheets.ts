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
	// oxlint-disable-next-line effecttsgo/new-promise -- DOM stylesheet load/error events have no native Promise API.
	const loaded = new Promise<void>((resolve, reject) => {
		let settled = false;
		const success = () => {
			if (settled) {
				return;
			}
			settled = true;
			resolve();
		};
		const failure = () => {
			if (settled) {
				return;
			}
			settled = true;
			stylesheetPromisesByUrl.delete(href);
			link.remove();
			reject(new Error(`Client stylesheet failed to load: ${href}`));
		};
		link.addEventListener("load", success, { once: true });
		link.addEventListener("error", failure, { once: true });
		if (existing) {
			const checkSettled = () => {
				if (existing.sheet) {
					success();
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
