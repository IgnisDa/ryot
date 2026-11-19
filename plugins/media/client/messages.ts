import type { LocalMessage, SelectCodes } from "@ryot-app/plugin-client-sdk";
import {
	type DisplayText,
	type Formatters,
	type Text,
	useDisplayText,
	useFormatters,
	useLocalMessage,
	useMessages,
	useStampedMessages,
} from "@ryot-app/plugin-client-sdk/react";
import { useMemo } from "react";

import { type Catalog, catalogMessage } from "../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";

export const useMediaMessages = () => useMessages(PLUGIN_PACKAGE_ID, catalogMessage);

/** The plugin's messages stamped for the host, such as screen titles. */
export const useMediaMessageBuilder = () => useStampedMessages(PLUGIN_PACKAGE_ID, catalogMessage);

export type MediaText = ReturnType<typeof useMediaMessages>;

export type CountKind = SelectCodes<Catalog, "count.value", "kind">;

export type MediaGroupMemberUnit = SelectCodes<Catalog, "group.tab", "unit">;

export type MediaTitleKind = SelectCodes<Catalog, "activity.row-completion", "kind">;

export type MediaReviewKind = SelectCodes<Catalog, "activity.row-review-this", "kind">;

export type MediaCopy = {
	readonly text: MediaText;
	readonly formatters: Formatters;
	readonly display: (text: DisplayText) => Text;
	readonly local: (message: LocalMessage) => Text;
};

export const useMediaCopy = (): MediaCopy => {
	const text = useMediaMessages();
	const formatters = useFormatters();
	const local = useLocalMessage(PLUGIN_PACKAGE_ID);
	const display = useDisplayText();
	return useMemo(() => ({ text, local, display, formatters }), [text, formatters, local, display]);
};
