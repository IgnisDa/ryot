import { catalogRegistry } from "@ryot-app/i18n/catalog";
import { format } from "@ryot-app/i18n/format";
import { SOURCE_LOCALE } from "@ryot-app/i18n/locale";
import type { Message } from "@ryot-app/i18n/message";
import { compilePluginCatalog } from "@ryot-app/plugin-kit/testing";
import { Effect } from "effect";

const mediaPackageRoot = new URL(
	"../",
	import.meta.resolve("@ryot-app/media-plugin/shared/analytics-recipes"),
).pathname;

export const renderMediaMessage = Effect.fn("renderMediaMessage")(function* (message: Message) {
	const catalog = yield* compilePluginCatalog(mediaPackageRoot);
	return format(
		catalogRegistry([{ catalog, locale: SOURCE_LOCALE, namespace: message.namespace }]),
		SOURCE_LOCALE,
		message,
	);
});
