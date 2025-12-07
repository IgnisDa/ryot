import { systemConfigDef } from "./definition";
import type { ConfigNode, GroupDef } from "./types";

type FieldRow = {
	envKey: string;
	default: string;
	required: boolean;
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
				required: !child.optional && child.default === undefined,
			});
		} else {
			childGroups.push(child as GroupDef);
		}
	}

	if (directFields.length > 0) {
		lines.push(
			"| Variable | Description | Required | Default |",
			"|---|---|---|---|",
			...directFields.map(
				(f) =>
					`| \`${f.envKey}\` | ${f.description} | ${f.required ? "Yes" : "No"} | \`${f.default}\` |`,
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
		"# App Backend Reference Configuration Reference\n",
		"> Auto-generated from the configuration definition. Do not edit manually.\n",
	];

	collectFields(systemConfigDef.def, 2, lines);

	await Bun.write(outputPath, lines.join("\n"));
}
