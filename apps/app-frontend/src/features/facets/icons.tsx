import {
	Activity,
	AlarmClock,
	Album,
	Antenna,
	Apple,
	Archive,
	Armchair,
	Award,
	BadgeCheck,
	Banknote,
	BarChart3,
	BatteryCharging,
	Bell,
	Bike,
	BookOpen,
	Briefcase,
	Building2,
	Calendar,
	Camera,
	Car,
	CheckSquare,
	ClipboardList,
	Clock3,
	CloudRain,
	Code,
	Coffee,
	Compass,
	Cpu,
	Dumbbell,
	Film,
	Flame,
	Folder,
	Gamepad2,
	Globe,
	HeartPulse,
	Home,
	Laptop,
	Leaf,
	ListChecks,
	type LucideIcon,
	MapPin,
	Medal,
	Moon,
	Mountain,
	Music,
	NotebookPen,
	Palette,
	PencilRuler,
	Plane,
	Rocket,
	Scale,
	ShieldCheck,
	ShoppingBag,
	Sparkles,
	Sun,
	Target,
	Trophy,
	UtensilsCrossed,
	Waves,
	Zap,
} from "lucide-react";

export interface FacetIconOption {
	icon: LucideIcon;
	label: string;
	value: `lucide:${string}`;
}

export const facetIconOptions = [
	{ icon: Activity, label: "Activity", value: "lucide:activity" },
	{ icon: AlarmClock, label: "Alarm Clock", value: "lucide:alarm-clock" },
	{ icon: Album, label: "Album", value: "lucide:album" },
	{ icon: Antenna, label: "Antenna", value: "lucide:antenna" },
	{ icon: Apple, label: "Apple", value: "lucide:apple" },
	{ icon: Archive, label: "Archive", value: "lucide:archive" },
	{ icon: Armchair, label: "Armchair", value: "lucide:armchair" },
	{ icon: Award, label: "Award", value: "lucide:award" },
	{ icon: BadgeCheck, label: "Badge Check", value: "lucide:badge-check" },
	{ icon: Banknote, label: "Banknote", value: "lucide:banknote" },
	{ icon: BarChart3, label: "Bar Chart", value: "lucide:bar-chart-3" },
	{
		icon: BatteryCharging,
		label: "Battery Charging",
		value: "lucide:battery-charging",
	},
	{ icon: Bell, label: "Bell", value: "lucide:bell" },
	{ icon: Bike, label: "Bike", value: "lucide:bike" },
	{ icon: BookOpen, label: "Book Open", value: "lucide:book-open" },
	{ icon: Briefcase, label: "Briefcase", value: "lucide:briefcase" },
	{ icon: Building2, label: "Building", value: "lucide:building-2" },
	{ icon: Calendar, label: "Calendar", value: "lucide:calendar" },
	{ icon: Camera, label: "Camera", value: "lucide:camera" },
	{ icon: Car, label: "Car", value: "lucide:car" },
	{ icon: CheckSquare, label: "Check Square", value: "lucide:check-square" },
	{
		icon: ClipboardList,
		label: "Clipboard List",
		value: "lucide:clipboard-list",
	},
	{ icon: Clock3, label: "Clock", value: "lucide:clock-3" },
	{ icon: CloudRain, label: "Cloud Rain", value: "lucide:cloud-rain" },
	{ icon: Code, label: "Code", value: "lucide:code" },
	{ icon: Coffee, label: "Coffee", value: "lucide:coffee" },
	{ icon: Compass, label: "Compass", value: "lucide:compass" },
	{ icon: Cpu, label: "CPU", value: "lucide:cpu" },
	{ icon: Dumbbell, label: "Dumbbell", value: "lucide:dumbbell" },
	{ icon: Film, label: "Film", value: "lucide:film" },
	{ icon: Flame, label: "Flame", value: "lucide:flame" },
	{ icon: Folder, label: "Folder", value: "lucide:folder" },
	{ icon: Gamepad2, label: "Gamepad", value: "lucide:gamepad-2" },
	{ icon: Globe, label: "Globe", value: "lucide:globe" },
	{ icon: HeartPulse, label: "Heart Pulse", value: "lucide:heart-pulse" },
	{ icon: Home, label: "Home", value: "lucide:home" },
	{ icon: Laptop, label: "Laptop", value: "lucide:laptop" },
	{ icon: Leaf, label: "Leaf", value: "lucide:leaf" },
	{ icon: ListChecks, label: "List Checks", value: "lucide:list-checks" },
	{ icon: MapPin, label: "Map Pin", value: "lucide:map-pin" },
	{ icon: Medal, label: "Medal", value: "lucide:medal" },
	{ icon: Moon, label: "Moon", value: "lucide:moon" },
	{ icon: Mountain, label: "Mountain", value: "lucide:mountain" },
	{ icon: Music, label: "Music", value: "lucide:music" },
	{ icon: NotebookPen, label: "Notebook Pen", value: "lucide:notebook-pen" },
	{ icon: Palette, label: "Palette", value: "lucide:palette" },
	{ icon: PencilRuler, label: "Pencil Ruler", value: "lucide:pencil-ruler" },
	{ icon: Plane, label: "Plane", value: "lucide:plane" },
	{ icon: Rocket, label: "Rocket", value: "lucide:rocket" },
	{ icon: Scale, label: "Scale", value: "lucide:scale" },
	{ icon: ShieldCheck, label: "Shield Check", value: "lucide:shield-check" },
	{ icon: ShoppingBag, label: "Shopping Bag", value: "lucide:shopping-bag" },
	{ icon: Sparkles, label: "Sparkles", value: "lucide:sparkles" },
	{ icon: Sun, label: "Sun", value: "lucide:sun" },
	{ icon: Target, label: "Target", value: "lucide:target" },
	{ icon: Trophy, label: "Trophy", value: "lucide:trophy" },
	{
		icon: UtensilsCrossed,
		label: "Utensils",
		value: "lucide:utensils-crossed",
	},
	{ icon: Waves, label: "Waves", value: "lucide:waves" },
	{ icon: Zap, label: "Zap", value: "lucide:zap" },
] satisfies FacetIconOption[];

const facetIconOptionsByValue = new Map<string, FacetIconOption>(
	facetIconOptions.map((option) => [option.value, option]),
);

export const facetIconSelectData = facetIconOptions.map((option) => ({
	label: option.label,
	value: option.value,
}));

interface FacetIconProps {
	size?: number;
	strokeWidth?: number;
	icon: string | null | undefined;
}

export function getFacetIconOption(icon: string | null | undefined) {
	if (!icon) return undefined;
	return facetIconOptionsByValue.get(icon);
}

export function FacetIcon(props: FacetIconProps) {
	const option = getFacetIconOption(props.icon);
	if (!option) return null;

	const Icon = option.icon;

	return (
		<Icon size={props.size ?? 16} strokeWidth={props.strokeWidth ?? 1.8} />
	);
}
