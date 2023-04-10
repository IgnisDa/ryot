import solid from "solid-start/vite";
import { defineConfig } from "vite";
import staticAdapter from "solid-start-static";

export default defineConfig({
	plugins: [
		solid({ adapter: staticAdapter() }),
		// solid({ ssr: true }),
		//
		// ssr({ prerender: true }),
	],
});
