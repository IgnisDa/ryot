import type { ReactElement } from "react";

const Layout = ({ children }: { children: ReactElement }) => {
	return <>Layout {children}</>;
};

export default function (page: ReactElement) {
	return <Layout>{page}</Layout>;
}
