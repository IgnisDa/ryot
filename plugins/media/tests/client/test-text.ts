import { catalogRegistry } from "@ryot-app/i18n/catalog";
import { format, formatDisplayText } from "@ryot-app/i18n/format";
import { stampNamespace } from "@ryot-app/i18n/message";
import { testFormatters } from "@ryot-app/kernel-messages/testing";
import { testPluginText } from "@ryot-app/plugin-client-sdk/testing";

import type { MediaCopy, MediaText } from "../../client/messages";
import { catalogMessage } from "../../shared/messages.generated";
import { englishCatalog } from "../english-catalog";
import { MEDIA_OWNER_ID } from "./served-names";

const registry = catalogRegistry([
	{ locale: "en", catalog: englishCatalog, namespace: MEDIA_OWNER_ID },
]);

/** Renders the media plugin's English catalog, as `useMediaMessages` does in a component. */
export const testMediaText: MediaText = testPluginText(
	MEDIA_OWNER_ID,
	catalogMessage,
	englishCatalog,
);

export const testMediaCopy: MediaCopy = {
	text: testMediaText,
	formatters: testFormatters,
	local: (message) => format(registry, "en", stampNamespace(MEDIA_OWNER_ID, message)),
	display: (text) => formatDisplayText((message) => format(registry, "en", message), text),
};
