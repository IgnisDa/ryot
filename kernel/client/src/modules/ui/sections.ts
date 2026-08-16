import type { Href } from "expo-router";

export type SectionNavItem = {
	readonly slug: string;
	readonly icon: string;
	readonly label: string;
	readonly href: Extract<Href, string>;
};

const matchesSection = (pathname: string, href: string) =>
	pathname.endsWith(href) || pathname.includes(`${href}/`);

export function activeSectionSlug<Item extends SectionNavItem>(
	pathname: string,
	sections: readonly Item[],
	fallback: Item["slug"],
): Item["slug"] {
	return sections.find((section) => matchesSection(pathname, section.href))?.slug ?? fallback;
}
