export const SANDBOX_SDK_ROOT_IMPORT = "@ryot/sandbox-sdk/core";
export const SANDBOX_SDK_ACTIVITY_IMPORT = "@ryot/sandbox-sdk/activity";
export const SANDBOX_SDK_AUTOMATION_IMPORT = "@ryot/sandbox-sdk/automation";
export const SANDBOX_SDK_PROVIDER_IMPORT = "@ryot/sandbox-sdk/provider";
export const SANDBOX_SDK_WORKFLOW_IMPORT = "@ryot/sandbox-sdk/workflow";

export const SANDBOX_RUNTIME_SDK_IMPORTS = [
	"@ryot/sandbox-sdk/effect",
	"@ryot/sandbox-sdk/cheerio",
	"@ryot/sandbox-sdk/youtubei",
	"@ryot/sandbox-sdk/fflate",
	"@ryot/sandbox-sdk/papaparse",
	"@ryot/sandbox-sdk/fast-xml-parser",
] as const;

export const SANDBOX_SDK_IMPORTS = [
	SANDBOX_SDK_ROOT_IMPORT,
	SANDBOX_SDK_ACTIVITY_IMPORT,
	SANDBOX_SDK_AUTOMATION_IMPORT,
	SANDBOX_SDK_PROVIDER_IMPORT,
	SANDBOX_SDK_WORKFLOW_IMPORT,
	"@ryot/sandbox-sdk/driver",
	"@ryot/sandbox-sdk/operation",
	"@ryot/sandbox-sdk/wire",
	...SANDBOX_RUNTIME_SDK_IMPORTS,
] as const;
