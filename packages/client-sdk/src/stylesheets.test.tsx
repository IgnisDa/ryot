import { describe, expect, it } from "vitest";

import { loadStylesheet } from "./stylesheets";

describe("lazy presentation stylesheets", () => {
	it("shares one link and promise between simultaneous presentations", async () => {
		const href = "/presentations/shared.css";
		const first = loadStylesheet(href);
		const second = loadStylesheet(href);
		expect(second).toBe(first);
		const links = document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`);
		expect(links).toHaveLength(1);
		links[0]?.dispatchEvent(new Event("load"));
		await expect(first).resolves.toBeUndefined();
		await expect(loadStylesheet(href)).resolves.toBeUndefined();
		expect(document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`)).toHaveLength(1);
	});

	it("recognizes a document-warmed stylesheet without adding a link", async () => {
		const href = "/presentations/warmed.css";
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = href;
		document.head.append(link);
		const loading = loadStylesheet(href);
		expect(document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`)).toHaveLength(1);
		link.dispatchEvent(new Event("load"));
		await expect(loading).resolves.toBeUndefined();
	});

	it("rejects a broken stylesheet without duplicating its link", async () => {
		const href = "/presentations/broken.css";
		const loading = loadStylesheet(href);
		document.querySelector(`link[href="${href}"]`)?.dispatchEvent(new Event("error"));
		await expect(loading).rejects.toThrow("Client stylesheet failed to load");
		await expect(loadStylesheet(href)).rejects.toThrow("Client stylesheet failed to load");
		expect(document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`)).toHaveLength(1);
	});

	it("rejects a warmed stylesheet whose error happened before first use", async () => {
		const href = "/presentations/warmed-error.css";
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = href;
		document.head.append(link);
		link.dispatchEvent(new Event("error"));
		const loading = loadStylesheet(href);
		if (document.readyState !== "complete") {
			window.dispatchEvent(new Event("load"));
		}
		await expect(loading).rejects.toThrow("Client stylesheet failed to load");
		expect(document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`)).toHaveLength(1);
	});
});
