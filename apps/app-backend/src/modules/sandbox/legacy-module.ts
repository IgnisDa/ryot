import { SANDBOX_LEGACY_RUNTIME_IMPORTS } from "#lib/infrastructure/sandbox-runtime/dependencies";

import { SANDBOX_HOST_CAPABILITIES } from "./capabilities";

export const LEGACY_SANDBOX_COMPILED_FORMAT = 0 as const;

const rewriteLegacyRuntimeImports = (source: string) =>
	Object.entries(SANDBOX_LEGACY_RUNTIME_IMPORTS).reduce(
		(rewritten, [legacyImport, sdkImport]) =>
			['"', "'", "`"].reduce(
				(code, quote) =>
					code.replaceAll(`${quote}${legacyImport}${quote}`, `${quote}${sdkImport}${quote}`),
				rewritten,
			),
		source,
	);

export const compileLegacySandboxModule = (source: string) => `
const definition = {
  definitionType: "ryot:legacy-sandbox-script",
  async execute(driverName, context, host, execution) {
    const { ${SANDBOX_HOST_CAPABILITIES.join(", ")} } = host;
    const drivers = Object.create(null);
    const driver = (name, run) => {
      drivers[name] = run;
    };

    await (async () => {
${rewriteLegacyRuntimeImports(source)}
    })();

    const run = drivers[driverName];
    if (typeof run !== "function") {
      throw new Error('Driver "' + driverName + '" is not defined in this script');
    }
    return await run(context, execution);
  },
};

export default definition;
`;
