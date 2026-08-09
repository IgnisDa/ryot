import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { describe, expect, it } from "vitest";

import { credentialImportSchema, listedImportSource, uploadImportSchema } from "./import-fixture";
import {
	groupImportSources,
	importPluginHeading,
	importSourceInputShape,
	importSourceRequirement,
	importSourceRow,
	startableImportSources,
} from "./source-selection";

const twoFileSchema = {
	unknownKeys: "strict",
	fields: {
		ratings: {
			type: "string",
			label: "Ratings",
			description: "Ratings file",
			format: { kind: "upload", allowedFileExtensions: ["csv"] },
		},
		history: {
			type: "string",
			label: "History",
			description: "History file",
			format: { kind: "upload", allowedFileExtensions: ["csv"] },
		},
	},
} satisfies AppSchema;

describe("import source input shape", () => {
	it("names the single accepted file format", () => {
		expect(importSourceInputShape(uploadImportSchema())).toBe("CSV file");
		expect(importSourceInputShape(uploadImportSchema({ extensions: ["zip"] }))).toBe("ZIP file");
	});

	it("lists a few accepted formats for one file", () => {
		expect(importSourceInputShape(uploadImportSchema({ extensions: ["csv", "json"] }))).toBe(
			"CSV or JSON file",
		);
		expect(importSourceInputShape(uploadImportSchema({ extensions: ["csv", "json", "zip"] }))).toBe(
			"CSV, JSON or ZIP file",
		);
	});

	it("counts the files when a service asks for more than one", () => {
		expect(importSourceInputShape(twoFileSchema)).toBe("2 files");
	});

	it("reads as a server import when nothing is uploaded", () => {
		expect(importSourceInputShape(credentialImportSchema)).toBe("Server");
	});
});

describe("import source grouping", () => {
	const sources = [
		listedImportSource({ slug: "ledger", name: "Ledger" }),
		listedImportSource({ slug: "archive", name: "Archive", description: "Bring over a backup" }),
		listedImportSource({
			slug: "scale",
			name: "Scale",
			pluginSlug: "fitness",
			inputSchema: credentialImportSchema,
		}),
		listedImportSource({
			slug: "vault",
			name: "Vault",
			isStartable: false,
			inputSchema: credentialImportSchema,
			missingPluginConfigKeys: ["RYOT_PLUGIN_MEDIA_ACCESS_TOKEN"],
		}),
	];

	it("groups by contributing plugin and sorts each group by name", () => {
		const groups = groupImportSources(sources, "");

		expect(groups.map((group) => group.heading)).toEqual(["Media", "Fitness"]);
		expect(groups.at(0)?.sources.map((source) => source.name)).toEqual([
			"Archive",
			"Ledger",
			"Vault",
		]);
		expect(groups.at(1)?.sources.map((source) => source.inputShape)).toEqual(["Server"]);
	});

	it("filters on name and description and drops emptied groups", () => {
		expect(
			groupImportSources(sources, "backup").flatMap((group) =>
				group.sources.map((source) => source.slug),
			),
		).toEqual(["archive"]);
		expect(
			groupImportSources(sources, "LEDG").flatMap((group) =>
				group.sources.map((source) => source.slug),
			),
		).toEqual(["ledger"]);
		expect(groupImportSources(sources, "nothing here")).toEqual([]);
		expect(groupImportSources(sources, "  ")).toHaveLength(2);
	});

	it("keeps an unconfigured service listed but out of the startable set", () => {
		const groups = groupImportSources(sources, "vault");
		const vault = groups.at(0)?.sources.at(0);

		expect(vault?.isStartable).toBe(false);
		expect(startableImportSources(groups)).toEqual([]);
		expect(importSourceRequirement(vault ?? importSourceRow(sources[0]))).toBe(
			"Set RYOT_PLUGIN_MEDIA_ACCESS_TOKEN on your server to use this.",
		);
	});

	it("says nothing about requirements for a startable service", () => {
		expect(importSourceRequirement(importSourceRow(sources[0]))).toBeUndefined();
	});

	it("titles a plugin heading from its slug", () => {
		expect(importPluginHeading("media")).toBe("Media");
		expect(importPluginHeading("home_media-library")).toBe("Home Media Library");
		expect(importPluginHeading("")).toBe("Other");
	});
});
