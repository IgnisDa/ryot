import { CLIENT_API_VERSION } from "@ryot-app/plugin-client-contract";

import type { PluginClientCompilerPackageInput } from "./input";

const encoder = new TextEncoder();

export const CLIENT_COMPILER_WARM_UP_INPUT = {
	kind: "page",
	name: "Compiler warm-up",
	apiVersion: CLIENT_API_VERSION,
	pageDeclarationHash: "compiler-warm-up",
	publicExports: { page: { kind: "page", entry: "client/index.tsx" } },
	files: {
		"client/styles.css": encoder.encode(".warm-up-logo { display: block; }"),
		"client/logo.svg": encoder.encode('<svg xmlns="http://www.w3.org/2000/svg" />'),
		"client/index.tsx": encoder.encode(`import "./styles.css";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { useState } from "react";
import logo from "./logo.svg";
export default function Page() {
 const [count, setCount] = useState(0);
 return <Button className="bg-accent" onClick={() => setCount(count + 1)}><img alt="" className="warm-up-logo" src={logo}/>{count}</Button>;
}`),
	},
} satisfies Extract<PluginClientCompilerPackageInput, { readonly kind: "page" }>;
