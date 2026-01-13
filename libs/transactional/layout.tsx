import {
	Body,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Img,
	Link,
	Preview,
	Section,
	Tailwind,
} from "@react-email/components";
import type { ReactNode } from "react";

type LayoutProps = {
	headingText: string;
	children: ReactNode;
};

const Layout = ({ headingText, children }: LayoutProps) => (
	<Html>
		<Head />
		<Preview>Message from Ryot</Preview>
		<Tailwind
			config={{
				theme: {
					extend: {
						colors: {
							"paragraph-gray": "#3c4149",
							"brand-heading-gray": "#484848",
						},
					},
				},
			}}
		>
			<Body style={main} className="bg-white">
				<Container className="my-0 mx-auto pt-5 px-0 pb-10 max-w-xl">
					<Img
						src="https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png"
						alt="Ryot"
						className="h-10 w-10 rounded-xl"
					/>
					<Heading className="text-2xl pt-4 px-0 font-normal text-brand-heading-gray tracking-tighter leading-3">
						{headingText}
					</Heading>
					<Section className="py-7 text-paragraph-gray">{children}</Section>
					<Hr className="border-[#dfe1e4] my-6" />
					<Link href="https://ryot.io" className="text-sm text-[#b4becc]">
						Ryot &copy; {new Date().getFullYear()}
					</Link>
				</Container>
			</Body>
		</Tailwind>
	</Html>
);

export default Layout;

const main = {
	fontFamily:
		'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
};
