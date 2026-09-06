import {
	CLIENT_API_VERSION,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/client-plugin-contract";
import { expect, it } from "vitest";

import { clientArtifactFile, clientArtifactMetadata } from "./artifact";

const encoder = new TextEncoder();

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

	expect(clientArtifactMetadata("Fixture plugin", [first, second])).toEqual({
		format: 1,
		apiVersion: CLIENT_API_VERSION,
		compilerVersion: CLIENT_COMPILER_VERSION,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		hash: "fc9b54af3c05f3a6c2e29b6df38a470fb3cfb4bb6f32cc44469bf112c2b906d0",
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
