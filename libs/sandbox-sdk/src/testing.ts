import type {
	CoreSandboxHostMethodMap,
	ExecutionMetadata,
	SandboxHost,
	SandboxManifest,
} from "./core.js";
import type * as z from "./zod.js";

type SandboxTestHost<Manifest extends SandboxManifest> = Omit<
	SandboxHost<Manifest["capabilities"]>,
	"getAppConfigValue"
> &
	("getAppConfigValue" extends Manifest["capabilities"][number]
		? {
				readonly getAppConfigValue: (
					key: Parameters<SandboxHost<Manifest["capabilities"]>["getAppConfigValue"]>[0],
				) => ReturnType<CoreSandboxHostMethodMap["getAppConfigValue"]>;
			}
		: object);

export function defineSandboxTestHost<const Manifest extends SandboxManifest>(
	_manifest: Manifest,
	host: SandboxTestHost<Manifest>,
): SandboxHost<Manifest["capabilities"]>;
export function defineSandboxTestHost(_manifest: SandboxManifest, host: unknown): unknown {
	return host;
}

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
