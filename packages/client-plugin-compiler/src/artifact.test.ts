import {
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/client-plugin-contract";
import { expect, it } from "vitest";

import { clientArtifactMetadata, clientAssetName, clientGeneratedArtifactFile } from "./artifact";

const encoder = new TextEncoder();

it("encodes generated files once and hashes exact asset bytes", () => {
	const text = "A\u0000é";
	const raw = new Uint8Array([0x41, 0x00, 0xc3, 0xa9]);

	expect(clientGeneratedArtifactFile("plugin.js", text).contents).toEqual(encoder.encode(text));
	expect(clientAssetName("client/image.png", raw)).toBe(
		"asset-f555927fe30e1204169a3fbe0b3031041342b375ae54f07ca4c355a7c2a30559.png",
	);
});

it("builds stable metadata from the plugin name, sorted byte hashes, and metadata identity", () => {
	const first = clientGeneratedArtifactFile("plugin.js", "first");
	const second = clientGeneratedArtifactFile("plugin.css", "second");

	expect(clientArtifactMetadata("Fixture plugin", [first, second])).toEqual({
		format: 1,
		apiVersion: 1,
		compilerVersion: CLIENT_COMPILER_VERSION,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		hash: "c3ef18e9f8597f871b4e4d9d94ec7ad0925c1f8d868de1773602f7870f9de47b",
	});
	expect(clientArtifactMetadata("Fixture plugin", [first, second])).toEqual(
		clientArtifactMetadata("Fixture plugin", [second, first]),
	);
	expect(clientArtifactMetadata("Fixture plugin", [first, second]).hash).not.toBe(
		clientArtifactMetadata("Renamed plugin", [first, second]).hash,
	);
	expect(clientArtifactMetadata("Fixture plugin", [first, second]).hash).not.toBe(
		clientArtifactMetadata("Fixture plugin", [
			{ ...first, contents: encoder.encode("changed") },
			second,
		]).hash,
	);
	expect(clientArtifactMetadata("Fixture plugin", [first, second]).hash).not.toBe(
		clientArtifactMetadata("Fixture plugin", [{ ...first, contentType: "text/plain" }, second])
			.hash,
	);
});
