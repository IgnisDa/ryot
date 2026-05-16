import { describe, expect, it } from "vitest";

import { activeSectionSlug, type SectionNavItem } from "./sections";

const sections = [
	{ icon: "house", slug: "general", label: "General", href: "/settings/general" },
	{ icon: "users", slug: "account", label: "Account", href: "/settings/account" },
] as const satisfies readonly SectionNavItem[];

describe("active section slug", () => {
	it.each([
		["/settings/account", "account"],
		["/media/settings/account", "account"],
		["/settings/account/sessions", "account"],
		["/settings", "general"],
	] as const)("resolves %s to %s", (pathname, expected) => {
		expect(activeSectionSlug(pathname, sections, "general")).toBe(expected);
	});
});
