import { Shield, TrendingUp, Zap } from "lucide-react";
import { FeatureCard } from "~/lib/components/FeatureCard";
import { SectionHeader } from "~/lib/components/SectionHeader";

export const FeaturesSection = () => {
	return (
		<section className="py-20 bg-muted/30">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<SectionHeader
					subtitle="Why Choose Ryot"
					title="Ditch the Spreadsheets, Embrace Ryot"
					description="Transform the way you track and analyze your personal data with our comprehensive, user-friendly platform designed for modern life management."
				/>

				<div className="grid md:grid-cols-3 gap-8">
					<FeatureCard
						icon={Zap}
						title="All-in-One Tracking"
						description="Monitor your books, movies, TV shows, workouts, and daily habits from a single, intuitive dashboard designed for comprehensive life tracking."
					/>

					<FeatureCard
						icon={TrendingUp}
						title="Insightful Analytics"
						description="Get detailed insights into your consumption patterns, progress trends, and personal growth with beautiful charts and meaningful statistics."
					/>

					<FeatureCard
						icon={Shield}
						title="Privacy First"
						description="Your personal data stays secure with enterprise-level encryption and complete control over your information. Self-hosted options available."
					/>
				</div>
			</div>
		</section>
	);
};
