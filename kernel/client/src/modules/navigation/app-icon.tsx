import {
	Box,
	ChevronDown,
	ChevronRight,
	Circle,
	CircleCheck,
	Film,
	FlaskConical,
	HeartPulse,
	Home,
	House,
	Puzzle,
	Settings,
	User,
} from "lucide-react";

const icons = {
	box: Box,
	film: Film,
	home: Home,
	user: User,
	house: House,
	puzzle: Puzzle,
	settings: Settings,
	"heart-pulse": HeartPulse,
	"chevron-down": ChevronDown,
	"circle-check": CircleCheck,
	"chevron-right": ChevronRight,
	"flask-conical": FlaskConical,
};

type AppIconProps = {
	readonly name: string;
	readonly size?: number;
	readonly className?: string;
};

export function AppIcon({ name, size = 16, className }: AppIconProps) {
	const known = Object.hasOwn(icons, name);
	const Icon = known ? icons[name as keyof typeof icons] : Circle;
	return (
		<Icon
			size={size}
			focusable="false"
			strokeWidth={1.7}
			aria-hidden="true"
			className={className}
			data-app-icon={known ? name : "fallback"}
		/>
	);
}
