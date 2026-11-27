import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { ClientPageCompositionIdentity } from "@ryot-app/contract/modules/pages/schemas";
import { pluginPackageKey } from "@ryot-app/contract/modules/plugins/references";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import type { DefinitionSnapshot } from "@ryot-app/definitions/snapshot";
import type { ClientArtifact } from "@ryot-app/plugin-client-contract";
import { kernelPublicationPage } from "@ryot-app/ryotql-recipes/publication-browse";
import { Effect, Schema } from "effect";

import { managedAssetLocatorKey } from "#lib/domain/managed-asset-locators";
import { managedAssetLocators } from "#modules/assets/storage/locators";
import {
	type CapturedClientPageComposition,
	clientPageArtifactHashes,
	composeClientPage,
} from "#modules/pages/preparation/composition";
import { pageModule } from "#modules/pages/preparation/graph";
import type { PublishedPage } from "#modules/pages/preparation/published-page";

import type { ValidatedArchiveBinary } from "./archive/archive";
import { archiveError } from "./archive/error";
import { type ArchivePublication, isArchiveJsonObject } from "./archive/schemas";
import { describeClientArtifact, readClientArtifact, validatePageArtifact } from "./pages";
import { savedArgumentSources } from "./saved-arguments";

export const kernelPublicationDocument = (
	definitions: DefinitionSnapshot,
): null | RyotQLDocument => {
	const [first, ...rest] = Object.values(definitions.entitySchemas).map((schema) => ({
		browse: null,
		sortTypes: {},
		slug: schema.slug,
		pluginId: schema.pluginId,
	}));
	if (!first) {
		return null;
	}
	const document = kernelPublicationPage({ schemas: [first, ...rest] }).document;
	return { queries: {}, ...(document.parameters ? { parameters: document.parameters } : {}) };
};

export const publicationArguments = (publication: ArchivePublication) =>
	Effect.forEach(
		[
			publication.definition.arguments,
			...(publication.snapshot ? [publication.snapshot.arguments] : []),
		],
		(values) => savedArgumentSources(publication.document, values, true),
	);

export const rewritePublicationAssets = Effect.fn(function* (
	value: unknown,
	locators: ReadonlyMap<string, AssetLocator>,
) {
	const replacements = new Map<string, AssetLocator>();
	for (const locator of managedAssetLocators(value)) {
		const key = managedAssetLocatorKey(locator);
		const replacement = locators.get(key);
		if (!replacement) {
			return yield* archiveError(
				"missing_reference_mapping",
				"Publication asset mapping is incomplete",
			);
		}
		replacements.set(key, replacement);
	}
	const rewrite = (child: JsonValue): JsonValue => {
		if (Array.isArray(child)) {
			return child.map(rewrite);
		}
		if (!isArchiveJsonObject(child)) {
			return child;
		}
		if (typeof child["type"] === "string" && typeof child["key"] === "string") {
			const replacement = replacements.get(`${child["type"]}:${child["key"]}`);
			if (replacement) {
				return replacement;
			}
		}
		return Object.fromEntries(Object.entries(child).map(([key, nested]) => [key, rewrite(nested)]));
	};
	const decoded = yield* Schema.decodeUnknownEffect(JsonValue)(value).pipe(
		Effect.mapError((error) => archiveError("invalid_entry", error.message)),
	);
	return rewrite(decoded);
});

export const importPublicationComposition = (
	composition: CapturedClientPageComposition,
	plugins: ReadonlyMap<string, string>,
	page: null | PublishedPage,
): CapturedClientPageComposition => {
	const pluginIds = new Map(
		composition.identity.contributors.flatMap((contributor) =>
			contributor.kind === "plugin"
				? [
						[
							contributor.pluginId,
							PluginId.make(plugins.get(pluginPackageKey(contributor)) ?? contributor.pluginId),
						] as const,
					]
				: [],
		),
	);
	const owner = (id: PluginId) => pluginIds.get(id) ?? id;
	const previous = composition.identity;
	const contributors = previous.contributors.map((contributor) => {
		if (contributor.kind === "plugin") {
			return { ...contributor, pluginId: owner(contributor.pluginId) };
		}
		if (contributor.kind === "page" && page) {
			return { ...contributor, pageId: page.pageId, definitionHash: page.definitionHash };
		}
		return contributor;
	});
	const common = {
		...previous,
		contributors,
		automaticRegistry: previous.automaticRegistry.map((entry) => ({
			...entry,
			ownerPluginId: owner(PluginId.make(entry.ownerPluginId)),
		})),
	};
	const identity: ClientPageCompositionIdentity =
		previous.application === "page"
			? {
					...common,
					application: "page",
					entry: page ? pageModule(page.pageId) : previous.entry,
					analyticsSections: previous.analyticsSections.map((entry) => ({
						...entry,
						ownerPluginId: owner(entry.ownerPluginId),
					})),
				}
			: { ...common, routes: previous.routes, application: "plugin-route" };
	return { identity, runtimeEntries: composition.runtimeEntries };
};

export const readPublicationComposition = Effect.fn(function* (
	snapshot: NonNullable<ArchivePublication["snapshot"]>,
	blobs: ReadonlyMap<string, ValidatedArchiveBinary>,
) {
	const { page, composition } = snapshot;
	const roots = composition.identity.contributors.filter(
		(contributor) => contributor.kind === "page",
	);
	if (
		composition.identity.application !== "page" ||
		(page
			? roots.length !== 1 ||
				roots[0]?.pageId !== page.pageId ||
				roots[0].artifactHash !== page.artifact.hash ||
				roots[0].revision !== page.revision
			: roots.length !== 0)
	) {
		return yield* archiveError("invalid_entry", "Publication composition page mismatch");
	}
	const hashes = clientPageArtifactHashes(composition.identity);
	if (
		composition.identity.contributors.some(
			(contributor) => contributor.kind === "plugin" && contributor.scope !== "system",
		) ||
		composition.artifacts.length !== hashes.length ||
		new Set(composition.artifacts.map(({ hash }) => hash)).size !== hashes.length
	) {
		return yield* archiveError("invalid_entry", "Invalid publication composition artifacts");
	}
	const artifacts: ClientArtifact[] = [];
	for (const hash of hashes) {
		const metadata = composition.artifacts.find((artifact) => artifact.hash === hash);
		if (!metadata) {
			return yield* archiveError("invalid_entry", "Missing publication composition artifact");
		}
		const artifact = yield* readClientArtifact(metadata, blobs);
		for (const contributor of composition.identity.contributors) {
			if (
				contributor.kind === "plugin" &&
				contributor.clientArtifactHash === hash &&
				(!("packageId" in artifact) || artifact.packageId !== contributor.packageId)
			) {
				return yield* archiveError("invalid_entry", "Publication artifact owner mismatch");
			}
		}
		if (hash === page?.artifact.hash) {
			yield* validatePageArtifact(artifact, page.definition);
			if (!Bun.deepEquals(describeClientArtifact(artifact), page.artifact)) {
				return yield* archiveError("invalid_entry", "Publication page artifact mismatch");
			}
		}
		artifacts.push(artifact);
	}
	yield* Effect.try({
		catch: () => archiveError("invalid_entry", "Invalid publication composition"),
		try: () =>
			composeClientPage({
				...composition,
				artifacts: new Map(artifacts.map((artifact) => [artifact.hash, artifact])),
			}),
	});
	return artifacts;
});
