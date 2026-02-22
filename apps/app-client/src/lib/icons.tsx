import {
	Bike,
	Book,
	BookHeart,
	BookImage,
	BookOpen,
	Camera,
	Car,
	Clapperboard,
	Coffee,
	Dumbbell,
	Film,
	Flame,
	Folders,
	Gamepad2,
	Globe,
	Headphones,
	Heart,
	HeartPulse,
	House,
	Leaf,
	Library,
	MapPin,
	MonitorPlay,
	Music,
	Palette,
	Plane,
	Plus,
	Podcast,
	Ruler,
	Search,
	Settings,
	Star,
	Target,
	Trophy,
	Tv,
	User,
	Utensils,
	Wine,
	Zap,
} from "lucide-react-native";
import type { ComponentType } from "react";
import { View } from "react-native";

type IconComponent = ComponentType<{
	size?: number;
	color?: string;
	strokeWidth?: number;
}>;

const iconRegistry: Record<string, IconComponent> = {
	tv: Tv,
	zap: Zap,
	car: Car,
	book: Book,
	leaf: Leaf,
	plus: Plus,
	film: Film,
	wine: Wine,
	user: User,
	star: Star,
	home: House,
	flame: Flame,
	plane: Plane,
	globe: Globe,
	heart: Heart,
	ruler: Ruler,
	music: Music,
	bicycle: Bike,
	camera: Camera,
	search: Search,
	coffee: Coffee,
	target: Target,
	trophy: Trophy,
	palette: Palette,
	folders: Folders,
	library: Library,
	podcast: Podcast,
	"map-pin": MapPin,
	dumbbell: Dumbbell,
	settings: Settings,
	utensils: Utensils,
	"book-open": BookOpen,
	"gamepad-2": Gamepad2,
	headphones: Headphones,
	"book-heart": BookHeart,
	"book-image": BookImage,
	"heart-pulse": HeartPulse,
	clapperboard: Clapperboard,
	"monitor-play": MonitorPlay,
};

type TrackerIconProps = {
	icon: string;
	size?: number;
	strokeWidth?: number;
};

function FallbackIcon({ size = 16 }: { size?: number }) {
	return (
		<View
			style={{
				width: size,
				height: size,
				borderRadius: size / 2,
				backgroundColor: "#a8a29e",
			}}
		/>
	);
}

export function TrackerIcon({ icon, size = 16, strokeWidth = 1.5 }: TrackerIconProps) {
	const IconComponent = iconRegistry[icon];
	if (!IconComponent) {
		return <FallbackIcon size={size} />;
	}
	return <IconComponent size={size} strokeWidth={strokeWidth} />;
}
