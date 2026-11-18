import { emptyCatalogRegistry, registerCatalog } from "@ryot-app/i18n/catalog";
import { format } from "@ryot-app/i18n/format";
import { formattersFor } from "@ryot-app/i18n/formatters";
import { SOURCE_LOCALE } from "@ryot-app/i18n/locale";
import { KERNEL_NAMESPACE, type Message } from "@ryot-app/i18n/message";
import { Text } from "@ryot-app/i18n/text";

import { catalog } from "../dist/locales/en.mjs";

/** A registry holding only the English kernel catalog, for tests that render kernel copy. */
export const testKernelRegistry = registerCatalog(
	emptyCatalogRegistry,
	KERNEL_NAMESPACE,
	SOURCE_LOCALE,
	catalog,
);

export const testKernelText = (message: Message) =>
	format(testKernelRegistry, SOURCE_LOCALE, message);

export const testFormatters = formattersFor(SOURCE_LOCALE);

/** Brands a literal as rendered text, for tests that pass copy to components. */
export const testText = (value: string) => Text(value);
