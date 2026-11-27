declare module "*.mdx" {
	import type { ComponentType } from "react";

	type BlogTableOfContentsItem = { id: string; depth: 2 | 3; label: string };

	type BlogFrontmatter = {
		title: string;
		description: string;
		publishedAt: string;
		properties: { labels: string[] };
	};

	export const frontmatter: BlogFrontmatter;
	export const tableOfContents: undefined | readonly BlogTableOfContentsItem[];

	const content: ComponentType;
	export default content;
}
