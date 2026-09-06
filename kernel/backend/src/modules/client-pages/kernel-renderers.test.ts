import { expect, it } from "@effect/vitest";

import { getKernelClientRenderer, getKernelEntityRenderer } from "./kernel-renderers";

it("looks up each supported kernel renderer with its compilation policy", () => {
	const browser = getKernelClientRenderer("entity-browser");
	const table = getKernelClientRenderer("results-table");
	const collection = getKernelEntityRenderer("collection");
	const controller = browser?.files["client/entity-browser-controller.tsx"];

	expect(browser?.definition.entry).toBe("client/entity-browser.tsx");
	expect(browser?.definition.automaticEntityPresentations).toBe(true);
	expect(table?.definition.entry).toBe("client/results-table.tsx");
	expect(table?.definition.automaticEntityPresentations).toBe(false);
	expect(collection?.definition.entry).toBe("client/collection-detail.tsx");
	expect(collection?.definition.automaticEntityPresentations).toBe(true);
	expect(table?.sourceHash).not.toBe(browser?.sourceHash);
	expect(Object.keys(browser?.files ?? {})).toContain("client/display-value.tsx");
	expect(Object.keys(collection?.files ?? {})).toContain("client/entity-browser-controller.tsx");
	expect(new TextDecoder().decode(controller)).toContain("refreshOnMutation: false");
	expect(getKernelClientRenderer("unknown")).toBeUndefined();
	expect(getKernelEntityRenderer("unknown")).toBeUndefined();
});
