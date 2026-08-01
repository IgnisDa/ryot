import { describe, expect, it } from "vitest";

import { activeSectionSlug, type SectionNavItem } from "./sections";

const sections = [
	{ icon: "house", slug: "preferences", label: "Preferences", href: "/settings/preferences" },
	{ icon: "users", slug: "account", label: "Account", href: "/settings/account" },
] as const satisfies readonly SectionNavItem[];

describe("active section slug", () => {
	it.each([
		["/settings/account", "account"],
		["/media/settings/account", "account"],
		["/settings/account/sessions", "account"],
		["/settings", "preferences"],
	] as const)("resolves %s to %s", (pathname, expected) => {
		expect(activeSectionSlug(pathname, sections, "preferences")).toBe(expected);
	});
});
