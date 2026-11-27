import type {
	PickEntityOutcome,
	PluginBridgePickEntityScreen,
} from "@ryot-app/plugin-client-contract";

import { useHostScreenSession } from "#/modules/ui/host-screen-session";

export const useEntityPickerSession = (
	options: {
		readonly onDismiss?: () => void;
		readonly onOpen?: (request: PluginBridgePickEntityScreen) => void;
	} = {},
) =>
	useHostScreenSession<PluginBridgePickEntityScreen, PickEntityOutcome>(
		{ kind: "cancelled" },
		options,
	);
