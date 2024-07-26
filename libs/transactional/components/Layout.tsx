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
	Text,
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
		<Body style={main}>
			<Container style={container}>
				<Img
					src="https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png"
					width="42"
					height="42"
					alt="Ryot"
					style={logo}
				/>
				<Heading style={heading}>{headingText}</Heading>
				<Section style={buttonContainer}>
					<Text style={paragraph}>{children}</Text>
				</Section>
				<Hr style={hr} />
				<Link href="https://ryot.io" style={reportLink}>
					Ryot
				</Link>
			</Container>
		</Body>
	</Html>
);

export default Layout;

const logo = {
	borderRadius: 21,
	width: 42,
	height: 42,
};

const main = {
	backgroundColor: "#ffffff",
	fontFamily:
		'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
};

const container = {
	margin: "0 auto",
	padding: "20px 0 48px",
	maxWidth: "560px",
};

const heading = {
	fontSize: "24px",
	letterSpacing: "-0.5px",
	lineHeight: "1.3",
	fontWeight: "400",
	color: "#484848",
	padding: "17px 0 0",
};

const paragraph = {
	margin: "0 0 15px",
	fontSize: "15px",
	lineHeight: "1.4",
	color: "#3c4149",
};

const buttonContainer = {
	padding: "27px 0 27px",
};

const reportLink = {
	fontSize: "14px",
	color: "#b4becc",
};

const hr = {
	borderColor: "#dfe1e4",
	margin: "42px 0 26px",
};
