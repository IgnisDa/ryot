import shared from "@ryot-app/testing/vitest.shared";
import { mergeConfig, type ViteUserConfig } from "vitest/config";

/**
 * jsdom installs browser globals and rewrites `import.meta.url` to an http URL, which breaks tests
 * that resolve real filesystem paths. `.test.tsx` is the repo's marker for a test that renders, so
 * the file extension is a sound environment boundary and keeps per-file `@vitest-environment`
 * docblocks out of the tree. Setup files belong to the DOM project alone because they touch
 * `window`.
 */
export const defineClientConfig = ({ setupFiles }: { setupFiles?: string[] } = {}) => {
	const client: ViteUserConfig = {
		test: {
			projects: [
				{ test: { name: "node", include: ["**/*.test.ts"] } },
				{
					test: {
						name: "dom",
						environment: "jsdom",
						include: ["**/*.test.tsx"],
						...(setupFiles === undefined ? {} : { setupFiles }),
					},
				},
			],
		},
	};

	return mergeConfig(shared, client);
};
