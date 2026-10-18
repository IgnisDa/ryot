import {
	type PluginIdentityReference,
	pluginPackageKey,
} from "@ryot-app/contract/modules/plugins/references";
import { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
import {
	mapPluginIdentityReferences,
	type RowSelection,
	type RyotQLDocument,
	type RyotQLDocumentWithSelections,
} from "@ryot-app/contract/modules/ryotql/language";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import type { InferSelectViewModel } from "drizzle-orm";
import { Effect } from "effect";

import type { userPlugin } from "#schema/tables/definitions";

import type { RyotQLExecutionScope } from "./catalog";

export type PluginBinding = Pick<
	InferSelectViewModel<typeof userPlugin>,
	"scope" | "pluginId" | "packageId"
>;

export const definitionReadContext = (scope: RyotQLExecutionScope) => {
	if (scope.type === "plugin") {
		return scope;
	}
	if (scope.type === "user") {
		return scope.definitionContext;
	}
	return undefined;
};

export const pluginIdentityReferences = (document: RyotQLDocument) => {
	const references = new Map<string, PluginIdentityReference>();
	mapPluginIdentityReferences(document, (reference) => {
		references.set(stableStringify(reference), reference);
		return reference;
	});
	return [...references.values()];
};

export const bindRyotQLDocument = Effect.fn("bindRyotQLDocument")(function* <
	Selection extends RowSelection,
>(
	document: RyotQLDocumentWithSelections<Selection>,
	scope: RyotQLExecutionScope,
	catalog: ReadonlyArray<PluginBinding>,
) {
	const localIds = new Set(catalog.map(({ pluginId }) => pluginId));
	const packages = new Map(
		catalog.map((entry) => [
			pluginPackageKey({ scope: entry.scope, packageId: PluginPackageId.make(entry.packageId) }),
			entry.pluginId,
		]),
	);
	const self = definitionReadContext(scope);
	const unresolvedIssue = (
		reference: PluginIdentityReference,
	): Extract<RyotQLBadRequest["reason"], { code: "unresolved-query-owner" }>["issue"] => {
		if (reference.kind === "self") {
			if (self === undefined) {
				return "self-unbound";
			}
			return "unavailable";
		}
		if (reference.kind === "local") {
			return "unavailable";
		}
		if (reference.scope === "user" && scope.type !== "user") {
			return "wrong-scope";
		}
		if (catalog.some((entry) => entry.packageId === reference.packageId)) {
			return "wrong-scope";
		}
		return "missing";
	};
	let diagnostic: undefined | RyotQLBadRequest["reason"];
	const bound = mapPluginIdentityReferences(document, (reference) => {
		let pluginId: string | undefined;
		if (reference.kind === "local") {
			pluginId = reference.pluginId;
		} else if (reference.kind === "self") {
			pluginId = self?.pluginId;
		} else if (!(reference.scope === "user" && scope.type !== "user")) {
			pluginId = packages.get(pluginPackageKey(reference));
		}
		if (pluginId === undefined || (reference.kind !== "self" && !localIds.has(pluginId))) {
			diagnostic ??= {
				reference,
				code: "unresolved-query-owner",
				issue: unresolvedIssue(reference),
			};
			return reference;
		}
		return { kind: "local", pluginId: PluginId.make(pluginId) } as const;
	});
	if (diagnostic) {
		return yield* new RyotQLBadRequest({ reason: diagnostic });
	}
	return bound;
});
