import type { Config } from "@react-router/dev/config";

export default {
	prerender: ["/", "/features", "/terms", "/pricing-promise"],
} satisfies Config;
