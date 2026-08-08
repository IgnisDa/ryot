import { CLIENT_BRIDGE_PROTOCOL_VERSION } from "@ryot/contract/modules/plugins/client";
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

it("builds stable metadata from sorted byte hashes and metadata identity", () => {
	const first = clientGeneratedArtifactFile("plugin.js", "first");
	const second = clientGeneratedArtifactFile("plugin.css", "second");

	expect(clientArtifactMetadata([first, second])).toEqual({
		format: 1,
		apiVersion: 1,
		compilerVersion: 1,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		hash: "fc89f62930dc35deb36298bc20196674416db1afd42b5a6703d3fbb505892421",
	});
	expect(clientArtifactMetadata([first, second])).toEqual(clientArtifactMetadata([second, first]));
	expect(clientArtifactMetadata([first, second]).hash).not.toBe(
		clientArtifactMetadata([{ ...first, contents: encoder.encode("changed") }, second]).hash,
	);
	expect(clientArtifactMetadata([first, second]).hash).not.toBe(
		clientArtifactMetadata([{ ...first, contentType: "text/plain" }, second]).hash,
	);
});
