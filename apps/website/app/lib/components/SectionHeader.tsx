import { cn } from "@ryot/ts-utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "~/lib/components/ui/badge";

type SectionHeaderProps = {
	as?: "h1" | "h2";
	subtitle?: string;
	icon?: LucideIcon;
	maxWidth?: string;
	title: string | ReactNode;
	description?: string | ReactNode;
	badgeVariant?: "default" | "secondary" | "outline" | "destructive";
};

export const SectionHeader = (props: SectionHeaderProps) => {
	const Icon = props.icon;
	const HeadingTag = props.as || "h2";
	const maxWidthClass = props.maxWidth || "max-w-3xl";
	const headingClass =
		HeadingTag === "h1"
			? "text-4xl lg:text-6xl font-bold text-foreground mb-6 leading-tight"
			: "text-3xl lg:text-4xl font-bold text-foreground mb-6";

	return (
		<div className="text-center mb-16">
			{props.subtitle && (
				<Badge variant={props.badgeVariant || "outline"} className="mb-6">
					{Icon && <Icon className="w-4 h-4 mr-2" />}
					{props.subtitle}
				</Badge>
			)}
			<HeadingTag className={headingClass}>{props.title}</HeadingTag>
			{props.description && (
				<p
					className={cn(
						"text-lg text-muted-foreground",
						maxWidthClass,
						"mx-auto",
						{ "leading-relaxed": typeof props.description === "string" },
					)}
				>
					{props.description}
				</p>
			)}
		</div>
	);
};
