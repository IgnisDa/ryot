import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
	srcDir: "src",
	lastUpdated: true,
	title: "Ryot Documentation",
	description: "Documentation for Ryot project and associated applications.",
	sitemap: {
		hostname: "https://docs.ryot.io",
	},
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
			{
				text: "Getting Started",
				items: [
					{ text: "Installation", link: "/" },
					{ text: "Migration", link: "/migration" },
					{ text: "Configuration", link: "/configuration" },
					{ text: "Deployment", link: "/deployment" },
					{ text: "Importing", link: "/importing" },
					{ text: "Integrations", link: "/integrations" },
					{
						text: "Guides",
						items: [
							{ text: "Authentication", link: "/guides/authentication" },
							{ text: "Books", link: "/guides/books" },
							{ text: "Exporting", link: "/guides/exporting" },
							{ text: "Video games", link: "/guides/video-games" },
						],
					},
					{ text: "Contributing", link: "/contributing" },
				],
			},
		],
	},
});
