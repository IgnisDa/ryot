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
	if (node.kind === "field") {
		return;
	}

	const heading = "#".repeat(level);
	lines.push(`${heading} ${node.description}\n`);

	const directFields: FieldRow[] = [];
	const childGroups: GroupDef[] = [];

	for (const [, child] of Object.entries(node.children)) {
		if (child.kind === "field") {
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

export async function generateConfigDocs(outputPath: string) {
	const lines: string[] = [
		"# App Backend Configuration Reference\n",
		"> Auto-generated from the configuration definition. Do not edit manually.\n",
	];

	collectFields(systemConfigDef, 2, lines);
	collectFields(appConfigDef, 2, lines);

	await Bun.write(outputPath, lines.join("\n"));
}
