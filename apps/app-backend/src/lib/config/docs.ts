import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { appConfigDef, systemConfigDef } from "./definition";
import type { ConfigNode, GroupDef } from "./types";

type FieldRow = {
	envKey: string;
	default: string;
	required: boolean;
	sensitive: boolean;
	description: string;
};

function collectFields(node: ConfigNode, level: number, lines: string[]): void {
	if (node._kind === "field") {
		return;
	}

	const heading = "#".repeat(level);
	lines.push(`${heading} ${node.description}\n`);

	const directFields: FieldRow[] = [];
	const childGroups: GroupDef[] = [];

	for (const [, child] of Object.entries(node.children as Record<string, ConfigNode>)) {
		if (child._kind === "field") {
			directFields.push({
				envKey: child.envKey,
				default: child.default ?? "—",
				description: child.description,
				sensitive: child.sensitive ?? false,
				required: !child.optional && child.default === undefined,
			});
		} else {
			childGroups.push(child as GroupDef);
		}
	}

	if (directFields.length > 0) {
		lines.push(
			"| Variable | Description | Required | Default | Sensitive |",
			"|---|---|---|---|---|",
			...directFields.map(
				(f) =>
					`| \`${f.envKey}\` | ${f.description} | ${f.required ? "Yes" : "No"} | \`${f.default}\` | ${f.sensitive ? "Yes" : "No"} |`,
			),
			"",
		);
	}

	for (const childGroup of childGroups) {
		collectFields(childGroup, level + 1, lines);
	}
}

export function generateConfigDocs(outputPath: string): void {
	const lines: string[] = [
		"# App Backend Configuration Reference\n",
		"> Auto-generated from the configuration definition. Do not edit manually.\n",
	];

	collectFields(systemConfigDef, 2, lines);
	collectFields(appConfigDef, 2, lines);

	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, lines.join("\n"), "utf8");
}
