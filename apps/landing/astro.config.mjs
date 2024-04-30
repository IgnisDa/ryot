import sitemap from "@astrojs/sitemap";
import tailwind from "@astrojs/tailwind";
import { defineConfig } from "astro/config";
import robotsTxt from "astro-robots-txt";

// https://astro.build/config
export default defineConfig({
	site: import.meta.env.DEV
		? "http://localhost:4200"
		: "https://ryot.pages.dev/",
	integrations: [tailwind(), sitemap(), robotsTxt()],
});
