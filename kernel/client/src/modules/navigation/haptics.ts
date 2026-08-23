import { Haptics, ImpactStyle } from "@capacitor/haptics";

import { isNativePlatform } from "#/modules/navigation/native-navigation";

export const impactLight = () => {
	if (!isNativePlatform()) {
		return;
	}
	void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
};
