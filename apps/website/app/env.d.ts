declare module "*.mdx" {
	import type { ComponentType } from "react";

	type BlogFrontmatter = {
		title: string;
		description: string;
		publishedAt: string;
		properties: { labels: string[] };
	};

	type BlogTableOfContentsItem = {
		id: string;
		depth: 2 | 3;
		label: string;
	};

	export const frontmatter: BlogFrontmatter;
	export const tableOfContents: readonly BlogTableOfContentsItem[] | undefined;

	const content: ComponentType;
	export default content;
}
