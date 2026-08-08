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
	Menu,
	Puzzle,
	Settings,
	User,
	X,
} from "lucide-react";

const icons = {
	box: Box,
	film: Film,
	home: Home,
	menu: Menu,
	user: User,
	x: X,
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
