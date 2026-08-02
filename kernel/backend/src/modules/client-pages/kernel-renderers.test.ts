import { expect, it } from "@effect/vitest";
import { compileClientPlugin } from "@ryot-app/client-plugin-compiler";
import { CLIENT_API_VERSION } from "@ryot-app/client-plugin-contract";
import { Effect } from "effect";

import { getKernelClientRenderer } from "./kernel-renderers";

it("looks up each supported kernel renderer with its compilation policy", () => {
	const browser = getKernelClientRenderer("entity-browser");
	const table = getKernelClientRenderer("results-table");
	const entry = browser?.files["client/entity-browser.tsx"];

	expect(browser?.definition.entry).toBe("client/entity-browser.tsx");
	expect(browser?.definition.automaticEntityPresentations).toBe(true);
	expect(table?.definition.entry).toBe("client/results-table.tsx");
	expect(table?.definition.automaticEntityPresentations).toBe(false);
	expect(table?.sourceHash).not.toBe(browser?.sourceHash);
	expect(Object.keys(browser?.files ?? {})).toContain("client/display-value.tsx");
	expect(new TextDecoder().decode(entry)).toContain("refreshOnMutation: false");
	expect(getKernelClientRenderer("unknown")).toBeUndefined();
});

it.effect("compiles every kernel renderer as a page artifact", () =>
	Effect.forEach(["entity-browser", "results-table"], (rendererName) => {
		const renderer = getKernelClientRenderer(rendererName);
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
);
