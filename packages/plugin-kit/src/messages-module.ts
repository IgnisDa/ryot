import { type CompiledCatalog, decodeCompiledCatalog } from "@ryot-app/i18n/catalog";
import { type MessageArgumentKinds, messageArgumentKinds } from "@ryot-app/i18n/compiler/arguments";
import { generateLocalBuilderModule } from "@ryot-app/i18n/compiler/codegen";
import { Result } from "effect";

export const CATALOG_MESSAGES_DIRECTORY = "shared/messages";

export const CATALOG_MESSAGES_MODULE = "shared/messages.generated.ts";

export const CATALOG_MESSAGE_BUILDER = "catalogMessage";

export const CATALOG_ROW_TEXT_BUILDER = "catalogRowText";

/**
 * The typed `catalogMessage` builder for a source-locale catalog. The catalog is decoded and
 * held to the catalog limits here, so every emitted key, argument name and select code is bounded
 * and inert in type position.
 */
export const catalogMessagesModule = (
	catalog: CompiledCatalog,
	descriptions: ReadonlyMap<string, string> = new Map(),
): Result.Result<string, ReadonlyArray<string>> => {
	const decoded = decodeCompiledCatalog(catalog);
	if (Result.isFailure(decoded)) {
		return Result.fail(decoded.failure);
	}
	const issues: string[] = [];
	const argumentKinds = new Map<string, MessageArgumentKinds>();
	for (const [key, message] of Object.entries(decoded.success)) {
		const kinds = messageArgumentKinds(message);
		if (Result.isFailure(kinds)) {
			issues.push(...kinds.failure.map((conflict) => `${key}: ${conflict}`));
		} else {
			argumentKinds.set(key, kinds.success);
		}
	}
	return issues.length > 0
		? Result.fail(issues)
		: Result.succeed(
				generateLocalBuilderModule({
					descriptions,
					typeName: "Catalog",
					arguments: argumentKinds,
					builderName: CATALOG_MESSAGE_BUILDER,
					bindingBuilderName: CATALOG_ROW_TEXT_BUILDER,
					builderModule: "@ryot-app/plugin-kit/messages",
				}),
			);
};
