import { Link } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import type React from "react";
import { Platform } from "react-native";

export function ExternalLink(props: React.ComponentProps<typeof Link>) {
	const { href, ...rest } = props;
	return (
		<Link
			target="_blank"
			{...rest}
			href={href}
			onPress={(e) => {
				if (Platform.OS !== "web") {
					e.preventDefault();
					if (typeof href === "string") {
						void WebBrowser.openBrowserAsync(href);
					}
				}
			}}
		/>
	);
}
