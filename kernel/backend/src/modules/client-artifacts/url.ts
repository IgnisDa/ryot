import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";

export const CLIENT_ARTIFACT_HASH_PATTERN = /^[a-f0-9]{64}$/;

export const canonicalClientArtifactFileName = (fileName: string): string | null => {
	let current = fileName;
	for (let depth = 0; depth < 16; depth++) {
		if (
			canonicalRelativePosixPathIssue(current) !== null ||
			current.includes("?") ||
			current.includes("#")
		) {
			return null;
		}
		if (!current.includes("%")) {
			return current;
		}
		let decoded: string;
		try {
			decoded = decodeURIComponent(current);
		} catch {
			return null;
		}
		if (decoded === current) {
			return current;
		}
		current = decoded;
	}
	return null;
};

export const buildClientAssetUrl = (artifactHash: string, accessKey: string, fileName: string) => {
	if (
		!CLIENT_ARTIFACT_HASH_PATTERN.test(artifactHash) ||
		(accessKey !== "public" && !/^[A-Za-z0-9_-]{43}$/.test(accessKey)) ||
		canonicalClientArtifactFileName(fileName) !== fileName
	) {
		throw new Error("Invalid client asset reference");
	}
	return `/api/client-assets/${artifactHash}/${accessKey}/${fileName.split("/").map(encodeURIComponent).join("/")}`;
};
