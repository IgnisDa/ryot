import type { ReactElement } from "react";

import type { SchemaFileCandidate } from "./file-upload";

export function FileDropZone(props: {
	readonly children: ReactElement;
	readonly onFileDropped: (file: SchemaFileCandidate) => void;
}) {
	return props.children;
}
