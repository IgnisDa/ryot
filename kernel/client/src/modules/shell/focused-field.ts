const reveal = () => {
	const field = document.activeElement;
	if (field instanceof HTMLElement && field.matches("input, textarea, [contenteditable]")) {
		field.scrollIntoView({ block: "nearest" });
	}
};

// The iOS keyboard plugin shrinks the web view after the keyboard animation and resets the
// scroll insets WebKit used to reveal the field, so the field must be revealed again here.
export function revealFocusedFieldOnResize() {
	window.addEventListener("resize", reveal);
	return () => window.removeEventListener("resize", reveal);
}
