export const parseImpersonationHandoff = (href: string) => {
	const url = new URL(href);
	const tickets = new URLSearchParams(url.hash.slice(1)).getAll("ticket");
	return {
		url: `${url.pathname}${url.search}`,
		ticket: tickets.length === 1 && tickets[0] !== "" ? tickets[0] : null,
	};
};
