import {
	clientArtifactFile,
	clientArtifactMetadata,
	clientRuntimeArtifactMetadata,
} from "@ryot-app/client-plugin-contract";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import { clientArtifactMatches } from "./repository";

const packageId = PluginPackageId.make("test/artifacts");
const otherPackageId = PluginPackageId.make("test/other-artifacts");
const file = clientArtifactFile({
	path: "module.js",
	contentType: "text/javascript",
	bytes: new TextEncoder().encode("export default 1;"),
});
const artifact = {
	...clientArtifactMetadata("Whiskey", packageId, [file], {
		imports: [],
		clientDeclarationHash: "d".repeat(64),
	}),
	files: [file],
};

describe("client artifact persistence identity", () => {
	it("does not substitute equal files owned by another package or the kernel", () => {
		const stored = artifact.files.map((item) => ({
			...item,
			artifactHash: artifact.hash,
			contents: Buffer.from(item.contents),
		}));
		const { files: _files, ...metadata } = artifact;
		expect(clientArtifactMatches(artifact, metadata, stored)).toBe(true);
		expect(
			clientArtifactMatches(artifact, { ...metadata, packageId: otherPackageId }, stored),
		).toBe(false);
		expect(clientArtifactMatches(artifact, { ...metadata, packageId: null }, stored)).toBe(false);
		const runtime = { ...clientRuntimeArtifactMetadata("Whiskey", [file]), files: [file] };
		expect(clientArtifactMatches(runtime, { ...metadata, hash: runtime.hash }, stored)).toBe(false);
	});

	it("rejects changed immutable file bytes and metadata during idempotent persistence", () => {
		const { files: _files, ...metadata } = artifact;
		const stored = artifact.files.map((item) => ({
			...item,
			artifactHash: artifact.hash,
			contents: Buffer.from(item.contents),
		}));
		expect(
			clientArtifactMatches(artifact, metadata, [
				{
					...stored[0],
					name: file.name,
					artifactHash: artifact.hash,
					contentType: file.contentType,
					contents: Buffer.from("export default 2;"),
				},
			]),
		).toBe(false);
		expect(
			clientArtifactMatches(
				artifact,
				{ ...metadata, compilerVersion: metadata.compilerVersion + 1 },
				stored,
			),
		).toBe(false);
	});
});
