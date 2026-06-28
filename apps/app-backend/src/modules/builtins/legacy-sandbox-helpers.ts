import titleCaseDelimiterHelperCode from "./sandbox-scripts/script-helpers/title-case-delimiters.sandbox.js" with { type: "text" };
import titleCaseHelperCode from "./sandbox-scripts/script-helpers/title-case.sandbox.js" with { type: "text" };

const injectHelpers = (helperCode: string, names: string, code: string) =>
	`const { ${names} } = (function () {\n${helperCode}\n})();\n\n${code}`;

export const withTitleCaseHelper = (code: string) =>
	injectHelpers(titleCaseHelperCode, "toTitleCase", code);

export const withDelimiterTitleCaseHelper = (code: string) =>
	injectHelpers(titleCaseDelimiterHelperCode, "toTitleCase", code);
