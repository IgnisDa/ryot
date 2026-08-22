import { expect, it } from "@effect/vitest";

import { composeClientPage } from "./composition";
import { descriptions, identity } from "./test-fixtures";

it("builds a structural manifest without copying compiled bytes or embedding grant URLs", () => {
	const manifest = composeClientPage({
		identity: identity(),
		artifacts: descriptions(),
		runtimeEntries: { bootstrap: "bootstrap.js", "@ryot-app/client-sdk": "runtime.js" },
	});
	expect(manifest.bootstrap).toEqual({ file: "bootstrap.js", artifactHash: "a".repeat(64) });
	expect(manifest.imports["@ryot-app/plugins/page/main"]).toEqual({
		file: "module.js",
		artifactHash: "b".repeat(64),
	});
	expect(manifest.descriptor.automaticRegistry[0]?.module).toEqual({
		binding: "Export0",
		specifier: "@ryot-app/plugins/presentation/card",
	});
	expect(manifest.descriptor.automaticRegistry[0]?.stylesheets).toEqual([
		{ file: "module.css", artifactHash: "c".repeat(64) },
	]);
	expect(JSON.stringify(manifest)).not.toContain("/api/client-assets/");
});
