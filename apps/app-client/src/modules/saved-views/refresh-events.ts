type AppState = "active" | "background" | "inactive" | "unknown" | "extension";

export const createSavedViewRefreshEvents = (refresh: () => void) => {
	let wasConnected: boolean | undefined;
	return {
		onAppStateChange: (state: AppState) => {
			if (state === "active") {
				refresh();
			}
		},
		onNetworkStateChange: (state: { isConnected?: boolean | null }) => {
			if (state.isConnected === true && wasConnected === false) {
				refresh();
			}
			if (state.isConnected !== undefined && state.isConnected !== null) {
				wasConnected = state.isConnected;
			}
		},
	};
};
