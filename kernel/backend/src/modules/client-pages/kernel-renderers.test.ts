import { expect, it } from "@effect/vitest";
import { compileClientPlugin } from "@ryot-app/client-plugin-compiler";
import { CLIENT_API_VERSION } from "@ryot-app/client-plugin-contract";
import { Effect } from "effect";

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

it.effect(
	"compiles every kernel renderer as a page artifact",
	() =>
		Effect.forEach(["entity-browser", "results-table", "collection"] as const, (rendererName) => {
			const renderer =
				rendererName === "collection"
					? getKernelEntityRenderer(rendererName)
					: getKernelClientRenderer(rendererName);
			if (!renderer) {
				return Effect.die(`Missing kernel renderer ${rendererName}`);
			}
			return compileClientPlugin({
				publicExports: {},
				application: "page",
				name: renderer.name,
				apiVersion: CLIENT_API_VERSION,
				contributorOrder: [rendererName],
				contributors: { [rendererName]: { files: renderer.files } },
				entry: { contributor: rendererName, path: renderer.definition.entry },
			}).pipe(
				Effect.tap((output) =>
					Effect.sync(() => expect(output.artifact.files.length).toBeGreaterThan(0)),
				),
			);
		}),
	50_000,
);
