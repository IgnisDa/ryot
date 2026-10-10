import { expect, it } from "@effect/vitest";
import {
	CALENDAR_KERNEL_RENDERER_DISPLAY_NAME,
	KernelSavedViewRendererName,
} from "@ryot-app/contract/modules/saved-views/schemas";

import {
	getKernelClientRenderer,
	getKernelEntityRenderer,
	listKernelEntityRenderers,
} from "./kernel-renderers";

it("looks up each supported kernel renderer with its compilation policy", () => {
	const browser = getKernelClientRenderer("entity-browser");
	const collectionBrowser = getKernelClientRenderer("collection-browser");
	const table = getKernelClientRenderer("results-table");
	const collection = getKernelEntityRenderer("collection");

	expect(browser?.definition.entry).toBe("client/entity-browser.tsx");
	expect(browser?.definition.automaticEntityPresentations).toBe(true);
	expect(collectionBrowser?.definition.entry).toBe("client/collection-browser.tsx");
	expect(collectionBrowser?.definition.automaticEntityPresentations).toBe(true);
	expect(table?.definition.entry).toBe("client/results-table.tsx");
	expect(table?.definition.automaticEntityPresentations).toBe(false);
	expect(collection?.definition.entry).toBe("client/collection-detail.tsx");
	expect(collection?.definition.automaticEntityPresentations).toBe(true);
	expect(table?.sourceHash).not.toBe(browser?.sourceHash);
	expect(Object.keys(browser?.files ?? {})).toContain("client/display-value.tsx");
	expect(Object.keys(collectionBrowser?.files ?? {})).toContain(
		"client/collection-card-results.tsx",
	);
	expect(Object.keys(collection?.files ?? {})).toContain("client/entity-browser-controller.tsx");
	expect(getKernelClientRenderer("unknown")).toBeUndefined();
	expect(getKernelEntityRenderer("unknown")).toBeUndefined();
});

it("registers the calendar under the shared display name and keeps display names unique", () => {
	const calendar = getKernelClientRenderer("calendar");
	expect(calendar?.name).toBe(CALENDAR_KERNEL_RENDERER_DISPLAY_NAME);
	expect(calendar?.definition.entry).toBe("client/calendar.tsx");
	expect(calendar?.definition.automaticEntityPresentations).toBe(false);
	const names = [
		...KernelSavedViewRendererName.literals.map((name) => getKernelClientRenderer(name)?.name),
		...listKernelEntityRenderers().map(({ name }) => name),
	];
	expect(names).not.toContain(undefined);
	expect(new Set(names).size).toBe(names.length);
});
