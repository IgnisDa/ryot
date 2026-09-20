import {
	pluginPackageKey,
	type PluginIdentityReference,
} from "@ryot-app/contract/modules/plugins/references";
import { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
import {
	mapPluginIdentityReferences,
	type RyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/language";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { InferSelectViewModel } from "drizzle-orm";
import { Effect } from "effect";

import type { userPlugin } from "#lib/infrastructure/db/schema/tables/definitions";

import type { RyotQLExecutionScope } from "./catalog";

export type PluginBinding = Pick<
	InferSelectViewModel<typeof userPlugin>,
	"pluginId" | "packageId" | "scope"
>;

export const pluginIdentityReferences = (document: RyotQLDocument) => {
	const references = new Map<string, PluginIdentityReference>();
	mapPluginIdentityReferences(document, (reference) => {
		references.set(JSON.stringify(reference), reference);
		return reference;
	});
	return [...references.values()];
};

export const bindRyotQLDocument = Effect.fn("bindRyotQLDocument")(function* (
	document: RyotQLDocument,
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
	const self = (() => {
		if (scope.type === "plugin") {
			return scope;
		}
		if (scope.type === "user") {
			return scope.definitionContext;
		}
		return undefined;
	})();
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
	const bindings = new Map<string, PluginIdentityReference>();
	let diagnostic: RyotQLBadRequest["reason"] | undefined;
	const bound = mapPluginIdentityReferences(document, (reference) => {
		const key = JSON.stringify(reference);
		const cached = bindings.get(key);
		if (cached) {
			return cached;
		}
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
		const resolved = { kind: "local", pluginId: PluginId.make(pluginId) } as const;
		bindings.set(key, resolved);
		return resolved;
	});
	if (diagnostic) {
		return yield* new RyotQLBadRequest({ reason: diagnostic });
	}
	return bound;
});
