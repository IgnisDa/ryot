import { sha256 } from "@noble/hashes/sha2.js";
import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import { stableStringify } from "@ryot-app/ts-utils/json";

const digest = (value: unknown) =>
	Array.from(sha256(new TextEncoder().encode(stableStringify(value))), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");

export const documentOwner = ({ context, identity }: PreparedClientPage) => {
	const documentId = "savedViewId" in identity ? identity.savedViewId : "";
	const documentRevision = "viewRevision" in identity ? identity.viewRevision : 0;
	// Plugin routes resolve their path, search, and parameters from the live location.
	const pluginRoute = context.target.kind === "plugin-route";
	const contextDigest = digest({
		view: context.view,
		settings: context.settings,
		renderer: context.renderer,
		dataSources: context.dataSources,
		route: pluginRoute ? undefined : context.route,
		target: { ...context.target, ...(pluginRoute ? { path: undefined, search: undefined } : {}) },
	});
	return `${identity.kind}:${documentId}:${documentRevision}:${contextDigest}`;
};
