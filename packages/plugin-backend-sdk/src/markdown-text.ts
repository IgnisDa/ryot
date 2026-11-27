export const escapeMarkdownText = (input: string): string =>
	input
		.replaceAll(/\r\n?/g, "\n")
		.split("\n")
		.map((line, index, lines) => {
			if (line.length === 0) {
				return "";
			}
			const escaped = line
				.replaceAll(/[!-/:-@[-`{-~]/g, "\\$&")
				.replaceAll(/^[ \t]+|[ \t]+$/g, (spaces) =>
					spaces.replaceAll(" ", "&#32;").replaceAll("	", "&#9;"),
				);
			return index < lines.length - 1 && lines[index + 1] !== "" ? `${escaped}\\` : escaped;
		})
		.join("\n");
