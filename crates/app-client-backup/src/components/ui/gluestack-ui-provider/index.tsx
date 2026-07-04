import { OverlayProvider } from "@gluestack-ui/core/overlay/creator";
import { ToastProvider } from "@gluestack-ui/core/toast/creator";
import type React from "react";
import { useEffect } from "react";
import { Appearance, View, type ViewProps } from "react-native";

export type ModeType = "light" | "dark" | "system";

export function GluestackUIProvider(props: {
	mode?: ModeType;
	children?: React.ReactNode;
	style?: ViewProps["style"];
}) {
	const { mode = "system", ...rest } = props;
	useEffect(() => {
		if (mode !== "system") {
			Appearance.setColorScheme(mode);
		}
	}, [mode]);

	return (
		<View style={[{ flex: 1, height: "100%", width: "100%" }, rest.style]}>
			<OverlayProvider>
				<ToastProvider>{rest.children}</ToastProvider>
			</OverlayProvider>
		</View>
	);
}
