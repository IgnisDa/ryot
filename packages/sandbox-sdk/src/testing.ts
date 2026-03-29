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
	"executeWorkflow" | "getPluginConfig" | "getSystemConfig"
> &
	("getPluginConfig" extends Manifest["capabilities"][number]
		? {
				readonly getPluginConfig: (
					keys: Parameters<SandboxHostMethodMap["getPluginConfig"]>[0],
				) => ReturnType<CoreSandboxHostMethodMap["getPluginConfig"]>;
			}
		: object) &
	("getSystemConfig" extends Manifest["capabilities"][number]
		? {
				readonly getSystemConfig: (
					keys: Parameters<SandboxHostMethodMap["getSystemConfig"]>[0],
				) => ReturnType<CoreSandboxHostMethodMap["getSystemConfig"]>;
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
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.ConstraintDecoder<unknown>,
	Host,
>(
	script: {
		readonly input: Input;
		readonly output: Output;
		readonly run: (
			input: Input["Type"],
			host: Host,
			execution: ExecutionMetadata,
		) => Effect.Effect<Output["Type"], unknown>;
	},
	input: Schema.Codec.Encoded<Input>,
	host: NoInfer<Host>,
	execution: ExecutionMetadata,
) => {
	return Schema.decodeUnknownEffect(script.input)(input).pipe(
		Effect.flatMap((parsedInput) => script.run(parsedInput, host, execution)),
		Effect.flatMap(Schema.decodeUnknownEffect(script.output)),
	);
};
