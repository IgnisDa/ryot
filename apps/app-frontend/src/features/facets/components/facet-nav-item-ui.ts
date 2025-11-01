import type { TrackingNavItem } from "../nav";

export function getFacetNavActionUi(
	facet: Pick<TrackingNavItem, "enabled" | "isBuiltin">,
) {
	if (!facet.isBuiltin) return { kind: "edit", label: "Edit facet" } as const;

	if (facet.enabled) return { kind: "toggle", label: "Disable facet" } as const;

	return { kind: "toggle", label: "Enable facet" } as const;
}
