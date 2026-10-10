import { expect, it } from "@effect/vitest";
import { pluginExportSpecifier } from "@ryot-app/plugin-client-contract";

import { composeClientPage } from "./composition";
import { descriptions, identity, pageReference, presentationReference } from "./test-fixtures";

it("builds a structural manifest without copying compiled bytes or embedding grant URLs", () => {
	const manifest = composeClientPage({
		identity: identity(),
		artifacts: descriptions(),
		runtimeEntries: { bootstrap: "bootstrap.js", "@ryot-app/plugin-client-sdk": "runtime.js" },
	});
	expect(manifest.bootstrap).toEqual({ file: "bootstrap.js", artifactHash: "a".repeat(64) });
	expect(manifest.imports[pluginExportSpecifier(pageReference, "main")]).toEqual({
		file: "module.js",
		artifactHash: "b".repeat(64),
	});
	expect(manifest.descriptor.automaticRegistry[0]?.module).toEqual({
		binding: "card",
		specifier: pluginExportSpecifier(presentationReference, "card"),
	});
	expect(manifest.descriptor.automaticRegistry[0]?.stylesheets).toEqual([
		{ file: "module.css", artifactHash: "c".repeat(64) },
	]);
	expect(JSON.stringify(manifest)).not.toContain("/api/client-assets/");
});
