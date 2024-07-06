import sitemap from "@astrojs/sitemap";
import tailwind from "@astrojs/tailwind";
import robotsTxt from "astro-robots-txt";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
	site: import.meta.env.DEV ? "http://localhost:4200" : "https://ryot.io/",
	integrations: [tailwind(), sitemap(), robotsTxt()],
});
