import { Pagination, PaginationProps, SimpleGrid } from "@mantine/core";
import { forwardRef } from "react";

export const ApplicationGrid = (props: {
	children: JSX.Element[];
}) => {
	return (
		<SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="lg">
			{props.children}
		</SimpleGrid>
	);
};

export const ApplicationPagination = forwardRef<
	HTMLDivElement,
	PaginationProps
>((props, ref) => (
	<Pagination {...props} ref={ref} boundaries={1} siblings={0} />
));
