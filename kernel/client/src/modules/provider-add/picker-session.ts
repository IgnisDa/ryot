import type {
	PluginBridgePickEntityScreen,
	PickEntityOutcome,
} from "@ryot-app/plugin-client-contract";

import { useHostScreenSession } from "#/modules/ui/host-screen-session";

export const useEntityPickerSession = (
	options: {
		readonly onOpen?: (request: PluginBridgePickEntityScreen) => void;
		readonly onDismiss?: () => void;
	} = {},
) =>
	useHostScreenSession<PluginBridgePickEntityScreen, PickEntityOutcome>(
		{ kind: "cancelled" },
		options,
	);
