import { CLIENT_API_VERSION } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { expect, it } from "vitest";

import {
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	clientArtifactFile,
	clientArtifactMetadata,
	clientDeclarationHash,
	clientRuntimeArtifactMetadata,
	pluginExportSpecifier,
} from "./artifact";

const encoder = new TextEncoder();
const packageId = PluginPackageId.make("test/primary");
const identity = {
	imports: [],
	clientDeclarationHash: clientDeclarationHash({ homeView: null, apiVersion: CLIENT_API_VERSION }),
};

it("preserves exact Vite output bytes and content type", () => {
	const contents = new Uint8Array([0x41, 0x00, 0xc3, 0xa9]);
	expect(
		clientArtifactFile({ bytes: contents, path: "plugin.js", contentType: "text/javascript" }),
	).toEqual({ contents, name: "plugin.js", contentType: "text/javascript" });
});

it("builds stable metadata from the plugin name, sorted byte hashes, and metadata identity", () => {
	const first = clientArtifactFile({
		path: "plugin.js",
		bytes: encoder.encode("first"),
		contentType: "text/javascript; charset=utf-8",
	});
	const second = clientArtifactFile({
		path: "plugin.css",
		bytes: encoder.encode("second"),
		contentType: "text/css; charset=utf-8",
	});

	expect(
		clientArtifactMetadata("Fixture plugin", packageId, [first, second], identity),
	).toMatchObject({
		format: 1,
		packageId,
		apiVersion: CLIENT_API_VERSION,
		compilerVersion: CLIENT_COMPILER_VERSION,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	});
	expect(clientArtifactMetadata("Fixture plugin", packageId, [first, second], identity)).toEqual(
		clientArtifactMetadata("Fixture plugin", packageId, [second, first], identity),
	);
	expect(
		clientArtifactMetadata("Fixture plugin", packageId, [first, second], identity).hash,
	).not.toBe(clientArtifactMetadata("Renamed plugin", packageId, [first, second], identity).hash);
	expect(
		clientArtifactMetadata("Fixture plugin", packageId, [first, second], identity).hash,
	).not.toBe(
		clientArtifactMetadata(
			"Fixture plugin",
			packageId,
			[{ ...first, contents: encoder.encode("changed") }, second],
			identity,
		).hash,
	);
	expect(
		clientArtifactMetadata("Fixture plugin", packageId, [first, second], identity).hash,
	).not.toBe(
		clientArtifactMetadata(
			"Fixture plugin",
			packageId,
			[{ ...first, contentType: "text/plain" }, second],
			identity,
		).hash,
	);
	expect(
		clientArtifactMetadata("Fixture plugin", packageId, [first, second], identity).hash,
	).not.toBe(
		clientArtifactMetadata(
			"Fixture plugin",
			PluginPackageId.make("test/dependency"),
			[first, second],
			identity,
		).hash,
	);
	expect(clientRuntimeArtifactMetadata("Fixture plugin", [first, second]).hash).not.toBe(
		clientArtifactMetadata("Fixture plugin", packageId, [first, second], identity).hash,
	);
});

it("encodes scoped package export targets without importer-local aliases", () => {
	expect(pluginExportSpecifier({ packageId, scope: "system" }, "card")).toBe(
		`@ryot-app/plugins/system/${packageId}/card`,
	);
	expect(pluginExportSpecifier({ packageId, scope: "user" }, "card")).toBe(
		`@ryot-app/plugins/user/${packageId}/card`,
	);
});

it("hashes canonical imported targets and the full client declaration", () => {
	const imports = [
		{ exportName: "card", reference: { packageId, scope: "user" as const } },
		{ exportName: "card", reference: { packageId, scope: "system" as const } },
	];
	const first = clientArtifactMetadata("Fixture", packageId, [], { ...identity, imports });
	const second = clientArtifactMetadata("Fixture", packageId, [], {
		...identity,
		imports: imports.toReversed(),
	});
	expect(first).toEqual(second);
	expect(
		first.imports.map(({ reference, exportName }) => pluginExportSpecifier(reference, exportName)),
	).toEqual([
		`@ryot-app/plugins/system/${packageId}/card`,
		`@ryot-app/plugins/user/${packageId}/card`,
	]);
	expect(first.hash).not.toBe(clientArtifactMetadata("Fixture", packageId, [], identity).hash);
	expect(first.hash).not.toBe(
		clientArtifactMetadata("Fixture", packageId, [], {
			imports,
			clientDeclarationHash: clientDeclarationHash({
				homeView: "all-items",
				apiVersion: CLIENT_API_VERSION,
			}),
		}).hash,
	);
	expect(clientRuntimeArtifactMetadata("Fixture", [], imports)).toEqual(
		clientRuntimeArtifactMetadata("Fixture", [], imports.toReversed()),
	);
	expect(clientRuntimeArtifactMetadata("Fixture", [], imports).hash).not.toBe(
		clientRuntimeArtifactMetadata("Fixture", []).hash,
	);
});
