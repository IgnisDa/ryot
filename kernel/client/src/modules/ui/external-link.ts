import * as WebBrowser from "expo-web-browser";

export const openExternalLink = (url: string) => {
	void WebBrowser.openBrowserAsync(url);
};
