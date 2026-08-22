import { useState, type DragEvent, type ReactElement } from "react";

import { browserFileCandidate } from "./browser-file";
import type { SchemaFileCandidate } from "./upload";

const stop = (event: DragEvent<HTMLDivElement>) => {
	event.preventDefault();
	event.stopPropagation();
};

export function FileDropZone(props: {
	readonly children: ReactElement;
	readonly onFileDropped: (file: SchemaFileCandidate) => void;
}) {
	const [dragging, setDragging] = useState(false);
	return (
		<div
			onDragOver={(event) => {
				stop(event);
				setDragging(true);
			}}
			onDragLeave={(event) => {
				stop(event);
				setDragging(false);
			}}
			onDrop={(event) => {
				stop(event);
				setDragging(false);
				const file = event.dataTransfer.files.item(0);
				if (file !== null) {
					props.onFileDropped(browserFileCandidate(file));
				}
			}}
			style={{
				minWidth: 0,
				display: "flex",
				flexDirection: "column",
				opacity: dragging ? 0.75 : 1,
			}}
		>
			{props.children}
		</div>
	);
}
