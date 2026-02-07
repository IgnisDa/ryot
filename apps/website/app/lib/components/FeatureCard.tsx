import type { LucideIcon } from "lucide-react";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/lib/components/ui/card";
import { FEATURE_CARD } from "~/lib/styles";

type FeatureCardProps = {
	icon: LucideIcon;
	title: string;
	description: string;
};

export function FeatureCard(props: FeatureCardProps) {
	const Icon = props.icon;

	return (
		<Card className={FEATURE_CARD}>
			<CardHeader className="text-center p-8">
				<div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-6">
					<Icon className="w-6 h-6 text-primary" />
				</div>
				<CardTitle className="text-xl mb-4">{props.title}</CardTitle>
				<CardDescription className="text-base">
					{props.description}
				</CardDescription>
			</CardHeader>
		</Card>
	);
}
