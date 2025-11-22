import {
	DynamicIcon,
	type IconName,
	iconNames,
} from "lucide-react/dynamic.mjs";

export interface TrackerIconOption {
	label: string;
	value: IconName;
}

function formatTrackerIconLabel(iconName: string) {
	return iconName
		.split("-")
		.map((part) => {
			const firstLetter = part.charAt(0).toUpperCase();
			return `${firstLetter}${part.slice(1)}`;
		})
		.join(" ");
}

export const trackerIconOptions = iconNames.map((value) => ({
	value,
	label: formatTrackerIconLabel(value),
})) satisfies TrackerIconOption[];

const trackerIconOptionsByValue = new Map<string, TrackerIconOption>(
	trackerIconOptions.map((option) => [option.value, option]),
);

export const trackerIconSelectData = trackerIconOptions.map((option) => ({
	value: option.value,
	label: option.label,
}));

interface TrackerIconProps {
	icon: string;
	size?: number;
	strokeWidth?: number;
}

export function getTrackerIconOption(icon: string) {
	if (!icon) return undefined;
	return trackerIconOptionsByValue.get(icon);
}

export function TrackerIcon(props: TrackerIconProps) {
	const option = getTrackerIconOption(props.icon);
	if (!option) return null;

	return (
		<DynamicIcon
			name={option.value}
			size={props.size ?? 16}
			strokeWidth={props.strokeWidth ?? 1.8}
		/>
	);
}
