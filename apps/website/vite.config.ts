import mdx from "@mdx-js/rollup";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import { safeRoutes } from "safe-routes/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	server: { allowedHosts: true },
	plugins: [
		{
			enforce: "pre",
			...mdx({
				rehypePlugins: [rehypeSlug],
				remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter],
			}),
		},
		reactRouter(),
		safeRoutes(),
		tailwindcss(),
		tsconfigPaths({ ignoreConfigErrors: true }),
	],
});
