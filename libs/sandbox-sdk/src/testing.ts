import type {
	CoreSandboxHostMethodMap,
	ExecutionMetadata,
	SandboxHost,
	SandboxHostMethodMap,
	SandboxManifest,
} from "./core";
import { Effect, Schema } from "./effect";

type SandboxTestHost<Manifest extends SandboxManifest> = Omit<
	SandboxHost<Manifest["capabilities"]>,
	"getPluginConfigValue" | "getSystemConfigValue"
> &
	("getPluginConfigValue" extends Manifest["capabilities"][number]
		? {
				readonly getPluginConfigValue: (
					key: Parameters<SandboxHostMethodMap["getPluginConfigValue"]>[0],
				) => ReturnType<CoreSandboxHostMethodMap["getPluginConfigValue"]>;
			}
		: object) &
	("getSystemConfigValue" extends Manifest["capabilities"][number]
		? {
				readonly getSystemConfigValue: (
					key: Parameters<SandboxHostMethodMap["getSystemConfigValue"]>[0],
				) => ReturnType<CoreSandboxHostMethodMap["getSystemConfigValue"]>;
			}
		: object);

export function defineSandboxTestHost<const Manifest extends SandboxManifest>(
	_manifest: Manifest,
	host: SandboxTestHost<Manifest>,
): SandboxHost<Manifest["capabilities"]>;
export function defineSandboxTestHost(_manifest: SandboxManifest, host: unknown): unknown {
	return host;
}

export const runSandboxTestScript = <
	Input extends Schema.Schema.AnyNoContext,
	Output extends Schema.Schema.AnyNoContext,
	Host,
>(
	script: {
		readonly input: Input;
		readonly output: Output;
		readonly run: (
			input: Schema.Schema.Type<Input>,
			host: Host,
			execution: ExecutionMetadata,
		) => Effect.Effect<Schema.Schema.Type<Output>, unknown>;
	},
	input: Schema.Schema.Encoded<Input>,
	host: NoInfer<Host>,
	execution: ExecutionMetadata,
) => {
	return Schema.decodeUnknown(script.input)(input).pipe(
		Effect.flatMap((parsedInput) => script.run(parsedInput, host, execution)),
		Effect.flatMap(Schema.decodeUnknown(script.output)),
	);
};
