import { DynamicIcon, type IconName, iconNames } from "lucide-react/dynamic";

export interface FacetIconOption {
	label: string;
	value: IconName;
}

function formatFacetIconLabel(iconName: string) {
	return iconName
		.split("-")
		.map((part) => {
			const firstLetter = part.charAt(0).toUpperCase();
			return `${firstLetter}${part.slice(1)}`;
		})
		.join(" ");
}

export const facetIconOptions = iconNames.map((value) => ({
	value,
	label: formatFacetIconLabel(value),
})) satisfies FacetIconOption[];

const facetIconOptionsByValue = new Map<string, FacetIconOption>(
	facetIconOptions.map((option) => [option.value, option]),
);

export const facetIconSelectData = facetIconOptions.map((option) => ({
	value: option.value,
	label: option.label,
}));

interface FacetIconProps {
	icon: string;
	size?: number;
	strokeWidth?: number;
}

export function getFacetIconOption(icon: string) {
	if (!icon) return undefined;
	return facetIconOptionsByValue.get(icon);
}

export function FacetIcon(props: FacetIconProps) {
	const option = getFacetIconOption(props.icon);
	if (!option) return null;

	return (
		<DynamicIcon
			name={option.value}
			size={props.size ?? 16}
			strokeWidth={props.strokeWidth ?? 1.8}
		/>
	);
}
