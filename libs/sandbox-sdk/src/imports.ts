export const SANDBOX_SDK_ROOT_IMPORT = "@ryot/sandbox-sdk";
export const SANDBOX_SDK_AUTOMATION_IMPORT = "@ryot/sandbox-sdk/automation";
export const SANDBOX_SDK_PROVIDER_IMPORT = "@ryot/sandbox-sdk/provider";
export const SANDBOX_SDK_TRIGGER_IMPORT = "@ryot/sandbox-sdk/trigger";

export const SANDBOX_RUNTIME_SDK_IMPORTS = [
	"@ryot/sandbox-sdk/zod",
	"@ryot/sandbox-sdk/dayjs",
	"@ryot/sandbox-sdk/cheerio",
	"@ryot/sandbox-sdk/youtubei",
	"@ryot/sandbox-sdk/dayjs/custom-parse-format",
] as const;

export const SANDBOX_SDK_IMPORTS = [
	SANDBOX_SDK_ROOT_IMPORT,
	SANDBOX_SDK_AUTOMATION_IMPORT,
	SANDBOX_SDK_PROVIDER_IMPORT,
	SANDBOX_SDK_TRIGGER_IMPORT,
	...SANDBOX_RUNTIME_SDK_IMPORTS,
] as const;
