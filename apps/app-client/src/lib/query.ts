import { useFocusEffect } from "@react-navigation/native";
import { QueryClient, focusManager, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import type { AppStateStatus } from "react-native";

export const queryClient = new QueryClient();

function onAppStateChange(status: AppStateStatus) {
	if (Platform.OS !== "web") {
		focusManager.setFocused(status === "active");
	}
}

export function useAppFocus() {
	useEffect(() => {
		const subscription = AppState.addEventListener("change", onAppStateChange);
		return () => subscription.remove();
	}, []);
}

export function useRefreshOnFocus() {
	const firstTimeRef = useRef(true);
	const client = useQueryClient();

	useFocusEffect(
		useCallback(() => {
			if (firstTimeRef.current) {
				firstTimeRef.current = false;
				return;
			}
			client.refetchQueries({ stale: true, type: "active" });
		}, [client]),
	);
}
