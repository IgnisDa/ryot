import { Github, MessageCircle } from "lucide-react";
import { SectionHeader } from "~/lib/components/SectionHeader";
import { Button } from "~/lib/components/ui/button";

export const CommunitySection = () => {
	return (
		<section className="py-20">
			<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
				<SectionHeader
					maxWidth="max-w-2xl"
					subtitle="Join the Community"
					title="Be Part of the Community"
					description="Connect with other Ryot users, share tips and tricks, get support, and stay updated with the latest features and improvements."
				/>
				<div className="flex flex-col sm:flex-row gap-4 justify-center">
					<a
						target="_blank"
						rel="noopener noreferrer"
						href="https://discord.gg/D9XTg2a7R8"
					>
						<Button size="lg" className="min-w-45">
							<MessageCircle className="w-5 h-5 mr-2" />
							Join Discord
						</Button>
					</a>
					<a
						target="_blank"
						rel="noopener noreferrer"
						href="https://github.com/IgnisDa/ryot"
					>
						<Button variant="outline" size="lg" className="min-w-45">
							<Github className="w-5 h-5 mr-2" />
							Follow on GitHub
						</Button>
					</a>
				</div>
			</div>
		</section>
	);
};
