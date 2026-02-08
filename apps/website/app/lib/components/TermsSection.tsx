import type { ReactNode } from "react";

interface TermsSectionProps {
	number: number;
	title: string;
	children: ReactNode;
}

export function TermsSection(props: TermsSectionProps) {
	return (
		<div className="mb-12">
			<div className="flex items-center mb-6">
				<div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center mr-3">
					<span className="text-primary font-semibold">{props.number}</span>
				</div>
				<h2 className="text-xl sm:text-2xl font-semibold text-foreground">
					{props.title}
				</h2>
			</div>
			{props.children}
		</div>
	);
}
