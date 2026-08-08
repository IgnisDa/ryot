import type { ComponentType } from "react";

type BlogFrontmatter = {
	title: string;
	description: string;
	publishedAt: string;
	properties: { labels: string[] };
};

export type BlogTableOfContentsItem = {
	id: string;
	depth: 2 | 3;
	label: string;
};

type BlogPostModule = {
	default: ComponentType;
	frontmatter: BlogFrontmatter;
	tableOfContents?: readonly BlogTableOfContentsItem[];
};

export type BlogPost = {
	content: ComponentType;
	frontmatter: BlogFrontmatter;
	tableOfContents?: readonly BlogTableOfContentsItem[];
};

const modules = import.meta.glob("./blog/**/*.mdx", { eager: true }) as Record<
	string,
	BlogPostModule
>;

const posts: Record<string, BlogPost> = Object.fromEntries(
	Object.entries(modules).map(([path, module]) => [
		path
			.replace(/^\.\/blog\//, "")
			.replace(/\/index\.mdx$/, "")
			.replace(/\.mdx$/, ""),
		{
			content: module.default,
			frontmatter: module.frontmatter,
			tableOfContents: module.tableOfContents,
		},
	]),
);

export function getBlogPost(slug: string | undefined) {
	return slug && Object.hasOwn(posts, slug) ? posts[slug] : undefined;
}
