import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { reservedPluginSlugs } from "@ryot/contract/modules/plugins/schemas";
import { expect, it } from "vitest";

const appDirectory = fileURLToPath(new URL("../../app", import.meta.url));

const collectRouteSegments = (directory: string): ReadonlyArray<string> =>
	readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory()) {
			return entry.name.startsWith("(")
				? collectRouteSegments(`${directory}/${entry.name}`)
				: [entry.name];
		}
		const segment = entry.name.replace(/(?:\.web)?\.tsx?$/, "");
		return segment === entry.name || segment === "index" || segment.startsWith("_")
			? []
			: [segment];
	});

it("reserves every global client route segment for the kernel", () => {
	const segments = collectRouteSegments(appDirectory).filter((segment) => !segment.startsWith("["));

	expect([...new Set(segments)].sort()).toEqual([...reservedPluginSlugs].sort());
});
