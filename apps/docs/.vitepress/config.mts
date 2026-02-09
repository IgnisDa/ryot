import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitepress";

const getSourceFiles = (dir: string) =>
	fs
		.readdirSync(path.resolve(__dirname, `../src/${dir}`))
		.filter(
			(file) =>
				file !== "overview.md" &&
				file !== "community.md" &&
				file.endsWith(".md"),
		)
		.sort()
		.map((file) => {
			const name = file.replace(".md", "");
			const text = name
				.split("-")
				.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
				.join(" ");
			return { text, link: `/${dir}/${name}` };
		});

const guidesSourceFiles = getSourceFiles("guides");
const conceptsSourceFiles = getSourceFiles("concepts");
const importingSourceFiles = getSourceFiles("importing");
const integrationsSourceFiles = getSourceFiles("integrations");

// https://vitepress.dev/reference/site-config
export default defineConfig({
	srcDir: "src",
	lastUpdated: true,
	title: "Ryot Documentation",
	sitemap: { hostname: "https://docs.ryot.io" },
	description: "Documentation for Ryot project and associated applications.",
	head: [
		[
			"link",
			{
				rel: "icon",
				href: "https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/favicon-32x32.png",
			},
		],
	],
	themeConfig: {
		outline: "deep",
		siteTitle: "Ryot",
		search: { provider: "local" },
		logo: "https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png",
		socialLinks: [{ icon: "github", link: "https://github.com/ignisda/ryot" }],
		sidebar: [
			{ text: "Installation", link: "/" },
			{ text: "Configuration", link: "/configuration" },
			{ text: "Deployment", link: "/deployment" },
			{
				collapsed: true,
				text: "Concepts",
				link: "/concepts/overview",
				items: [
					{ text: "Overview", link: "/concepts/overview" },
					...conceptsSourceFiles,
				],
			},
			{
				collapsed: true,
				text: "Importing",
				link: "/importing/overview",
				items: [
					{ text: "Overview", link: "/importing/overview" },
					...importingSourceFiles,
					{ text: "Community", link: "/importing/community" },
				],
			},
			{
				collapsed: true,
				text: "Integrations",
				link: "/integrations/overview",
				items: [
					{ text: "Overview", link: "/integrations/overview" },
					...integrationsSourceFiles,
				],
			},
			{
				text: "Guides",
				collapsed: true,
				items: guidesSourceFiles,
				link: guidesSourceFiles[0].link,
			},
			{ text: "Exporting", link: "/exporting" },
			{ text: "Migration", link: "/migration" },
			{ text: "Contributing", link: "/contributing" },
		],
	},
});
