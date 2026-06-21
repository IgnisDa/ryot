import type { ExecutionMetadata, SandboxHost, SandboxManifest } from "./index.js";
import type * as z from "./zod.js";

export const defineSandboxTestHost = <const Manifest extends SandboxManifest>(
	_manifest: Manifest,
	host: SandboxHost<Manifest["capabilities"]>,
) => host;

export const runSandboxTestDriver = async <Input extends z.ZodType, Output extends z.ZodType, Host>(
	driver: {
		readonly input: Input;
		readonly output: Output;
		readonly run: (
			input: z.output<Input>,
			host: Host,
			execution: ExecutionMetadata,
		) => Promise<z.output<Output>>;
	},
	input: z.input<Input>,
	host: NoInfer<Host>,
	execution: ExecutionMetadata,
) => {
	const parsedInput = await driver.input.parseAsync(input);
	const output = await driver.run(parsedInput, host, execution);
	return driver.output.parseAsync(output);
};
