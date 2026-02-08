import { Github, MessageCircle } from "lucide-react";
import { SectionHeader } from "~/lib/components/SectionHeader";
import { Button } from "~/lib/components/ui/button";
import { SECTION_CONTAINER_NARROW, SECTION_Y_PADDING } from "~/lib/styles";

export const CommunitySection = () => {
	return (
		<section className={SECTION_Y_PADDING}>
			<div className={`${SECTION_CONTAINER_NARROW} text-center`}>
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
