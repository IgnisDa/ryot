import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
	srcDir: "src",
	title: "Ryot Documentation",
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
		siteTitle: "Ryot",
		logo: "https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png",
		socialLinks: [{ icon: "github", link: "https://github.com/ignisda/ryot" }],
		sidebar: [
			{
				text: "Getting Started",
				items: [
					{ text: "Installation", link: "/installation" },
					{ text: "Configuration", link: "/configuration" },
				],
			},
		],
	},
});
