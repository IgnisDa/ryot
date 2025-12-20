import type { ExecutionMetadata, GenericDriver, SandboxHost, SandboxManifest, z } from "./index.js";

export const defineSandboxTestHost = <const Manifest extends SandboxManifest>(
	_manifest: Manifest,
	host: SandboxHost<Manifest["capabilities"]>,
) => host;

export const runSandboxTestDriver = async <
	Input extends z.ZodType,
	Output extends z.ZodType,
	Capabilities extends SandboxManifest["capabilities"],
>(
	driver: GenericDriver<Input, Output, Capabilities>,
	input: z.input<Input>,
	host: SandboxHost<Capabilities>,
	execution: ExecutionMetadata,
) => {
	const parsedInput = await driver.input.parseAsync(input);
	const output = await driver.run(parsedInput, host, execution);
	return driver.output.parseAsync(output);
};
