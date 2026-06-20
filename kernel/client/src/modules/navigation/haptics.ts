import { Haptics, ImpactStyle } from "@capacitor/haptics";

import { isNativePlatform } from "#/modules/navigation/native-navigation";

export const impactLight = () => {
	if (!isNativePlatform()) {
		return;
	}
	void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
};

export const selectionChanged = () => {
	if (!isNativePlatform()) {
		return;
	}
	void Haptics.selectionStart()
		.then(() => Haptics.selectionChanged())
		.then(() => Haptics.selectionEnd())
		.catch(() => undefined);
};
