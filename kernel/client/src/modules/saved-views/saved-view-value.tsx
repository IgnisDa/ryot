import { Text } from "react-native";

import type { SavedViewScalarValue } from "./display-data";
import { formatSavedViewValue } from "./display-value";

export function SavedViewValue(props: { value: SavedViewScalarValue; className: string }) {
	return (
		<Text className={props.className} numberOfLines={1}>
			{formatSavedViewValue(props.value)}
		</Text>
	);
}
