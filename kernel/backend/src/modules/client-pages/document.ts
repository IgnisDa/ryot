import type {
	ClientArtifactFileReference,
	ClientCompositionDocument,
	ClientPageCompositionManifest,
} from "@ryot-app/contract/modules/client-pages/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { ClientArtifactGrantService } from "#modules/client-artifacts/grant-service";
import { ClientArtifactStore } from "#modules/client-artifacts/store";
import { buildClientAssetUrl } from "#modules/client-artifacts/url";

import type { ArtifactDescription } from "./composition";

type Plan = Pick<ClientCompositionDocument, "modulepreloads" | "preloads" | "stylesheets">;

const otherPreload = (type: string): Plan["preloads"][number]["as"] => {
	if (type.startsWith("font/")) {
		return "font";
	}
	if (type.startsWith("image/")) {
		return "image";
	}
	return "fetch";
};

/** One decision point for both eager preload and authorized lazy warming. */
export const planClientDocumentPreloads = (
	manifest: ClientPageCompositionManifest,
	artifacts: ReadonlyMap<string, ArtifactDescription>,
	access: ReadonlyMap<string, string>,
): Plan => {
	const eager = new Set(manifest.identity.eagerArtifactHashes);
	const lazy = new Set(
		manifest.descriptor.automaticRegistry.flatMap(({ artifactClosure }) => artifactClosure),
	);
	const modulepreloads = new Set<string>();
	const stylesheets = new Set<string>();
	const preloads = new Map<string, Plan["preloads"][number]>();
	for (const hash of [...new Set([...eager, ...lazy])].sort()) {
		const key = access.get(hash);
		if (!key || (!eager.has(hash) && key === "public")) {
			continue;
		}
		const description = artifacts.get(hash);
		if (!description) {
			throw new Error(`Client artifact is missing: ${hash}`);
		}
		for (const { name, contentType } of description.files) {
			const url = buildClientAssetUrl(hash, key, name);
			if (/^(text|application)\/javascript(?:;|$)/.test(contentType)) {
				modulepreloads.add(url);
			} else if (contentType.startsWith("text/css")) {
				stylesheets.add(url);
			} else {
				const as = otherPreload(contentType);
				preloads.set(url, { as, href: url, type: contentType });
			}
		}
	}
	return {
		stylesheets: [...stylesheets].sort(),
		modulepreloads: [...modulepreloads].sort(),
		preloads: [...preloads.values()].sort((a, b) => a.href.localeCompare(b.href)),
	};
};

export const renderClientDocument = (
	manifest: ClientPageCompositionManifest,
	artifacts: ReadonlyMap<string, ArtifactDescription>,
	access: ReadonlyMap<string, string>,
	compositionHash: string,
): ClientCompositionDocument => {
	const url = ({ file, artifactHash }: ClientArtifactFileReference) => {
		const key = access.get(artifactHash);
		if (!key || !artifacts.get(artifactHash)?.files.some(({ name }) => name === file)) {
			throw new Error(`Client document file is missing: ${artifactHash}/${file}`);
		}
		return buildClientAssetUrl(artifactHash, key, file);
	};
	const imports = Object.fromEntries(
		Object.entries(manifest.imports).map(([specifier, reference]) => [specifier, url(reference)]),
	);
	const { format, apiVersion, bridgeVersion, compilerVersion } = manifest.identity;
	return {
		...planClientDocumentPreloads(manifest, artifacts, access),
		importMap: { imports },
		title: manifest.identity.name,
		bootstrap: url(manifest.bootstrap),
		metadata: { format, apiVersion, bridgeVersion, compilerVersion, hash: compositionHash },
		descriptor: {
			...manifest.descriptor,
			automaticRegistry: manifest.descriptor.automaticRegistry.map(
				({ stylesheets, artifactClosure: _closure, ...registration }) => ({
					...registration,
					stylesheets: [...new Set(stylesheets.map(url))],
				}),
			),
		},
	};
};

export const generateClientDocument = Effect.fn("ClientPages.generateDocument")(function* (
	userId: UserId,
	compositionHash: string,
	manifest: ClientPageCompositionManifest,
) {
	const store = yield* ClientArtifactStore;
	const grants = yield* ClientArtifactGrantService;
	const hashes = new Set([
		manifest.bootstrap.artifactHash,
		...Object.values(manifest.imports).map(({ artifactHash }) => artifactHash),
		...manifest.identity.eagerArtifactHashes,
		...manifest.descriptor.automaticRegistry.flatMap(({ artifactClosure }) => artifactClosure),
	]);
	const artifacts = new Map<string, ArtifactDescription>();
	const access = new Map<string, string>();
	for (const hash of [...hashes].sort()) {
		const description = yield* store.describe(hash);
		if (!description) {
			return yield* Effect.die(new Error(`Client composition artifact is missing: ${hash}`));
		}
		artifacts.set(hash, description);
		access.set(hash, store.isPublic(hash) ? "public" : (yield* grants.issue(userId, hash)).token);
	}
	return yield* Effect.try(() =>
		renderClientDocument(manifest, artifacts, access, compositionHash),
	).pipe(Effect.orDie);
});
