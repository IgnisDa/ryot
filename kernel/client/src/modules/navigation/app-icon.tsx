import {
	Box,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Circle,
	CircleCheck,
	Film,
	FlaskConical,
	HeartPulse,
	Home,
	House,
	Menu,
	Puzzle,
	Settings,
	SlidersHorizontal,
	User,
	X,
} from "lucide-react";

const icons = {
	x: X,
	box: Box,
	film: Film,
	home: Home,
	menu: Menu,
	user: User,
	house: House,
	puzzle: Puzzle,
	settings: Settings,
	"heart-pulse": HeartPulse,
	"chevron-down": ChevronDown,
	"chevron-left": ChevronLeft,
	"circle-check": CircleCheck,
	"chevron-right": ChevronRight,
	"flask-conical": FlaskConical,
	"sliders-horizontal": SlidersHorizontal,
};

type AppIconProps = {
	readonly name: string;
	readonly size?: number;
	readonly className?: string;
};

const isIconName = (name: string): name is keyof typeof icons => Object.hasOwn(icons, name);

export function AppIcon({ name, size = 16, className }: AppIconProps) {
	const known = isIconName(name);
	const Icon = known ? icons[name] : Circle;
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
