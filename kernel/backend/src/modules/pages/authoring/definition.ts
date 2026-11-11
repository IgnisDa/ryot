import { PageAuthoringError, PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import { isPluginSharedSource } from "@ryot-app/contract/modules/plugins/shared-file-policy";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "@ryot-app/plugin-client-compiler/limits";
import {
	CLIENT_API_VERSION,
	pageDeclarationHash,
	pluginClientAssetMimeType,
	pluginClientFileExtension,
} from "@ryot-app/plugin-client-contract";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { Effect, Schema } from "effect";

export const definitionInvalid = (message: string) =>
	new PageAuthoringError({ reason: { message, code: "definition-invalid" } });

export const preparePageDefinition = Effect.fn("preparePageDefinition")(function* (
	input: PageDefinition,
) {
	const definition = yield* Schema.decodeEffect(PageDefinition)(input).pipe(
		Effect.mapError((error) => definitionInvalid(error.message)),
	);
	const paths = new Set<string>();
	let size = 0;
	const files: Record<string, Uint8Array> = {};
	for (const file of definition.files) {
		if (
			paths.has(file.path) ||
			canonicalRelativePosixPathIssue(file.path) !== null ||
			!(file.path.startsWith("client/")
				? pluginClientFileExtension(file.path) !== undefined
				: isPluginSharedSource(file.path))
		) {
			return yield* definitionInvalid(`Invalid or duplicate source path: ${file.path}`);
		}
		paths.add(file.path);
		const contents = Uint8Array.from(Buffer.from(file.content, "base64"));
		size += contents.byteLength;
		if (
			pluginClientAssetMimeType(file.path) !== undefined &&
			contents.byteLength > CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes
		) {
			return yield* definitionInvalid(`Asset exceeds compiler limit: ${file.path}`);
		}
		files[file.path] = contents;
	}
	if (size > CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes) {
		return yield* definitionInvalid("Sources exceed compiler size limit");
	}
	if (
		!paths.has(definition.entry) ||
		!definition.entry.startsWith("client/") ||
		!/\.tsx?$/.test(definition.entry)
	) {
		return yield* definitionInvalid("Entry must reference a client TypeScript source file");
	}
	const canonical = {
		...definition,
		files: [...definition.files].sort((left, right) => left.path.localeCompare(right.path)),
	};
	const definitionHash = sha256Hex(stableStringify(canonical));
	return {
		definitionHash,
		definition: canonical,
		compilerInput: {
			files,
			name: "page",
			kind: "page" as const,
			apiVersion: CLIENT_API_VERSION,
			pluginDependencies: definition.pluginDependencies,
			pageDeclarationHash: pageDeclarationHash(definition),
			publicExports: { page: { kind: "page" as const, entry: definition.entry } },
		},
	};
});
