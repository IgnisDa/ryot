import * as Clipboard from "expo-clipboard";

export const copyTextToClipboard = (text: string) => {
	void Clipboard.setStringAsync(text);
};
