export interface SidebarFacet {
	id: string;
	icon: string;
	slug: string;
	name: string;
	enabled: boolean;
	sortOrder: number;
	accentColor: string;
	isExpanded?: boolean;
	views?: SidebarView[];
}

export interface SidebarView {
	id: string;
	icon: string;
	name: string;
	slug: string;
	accentColor: string;
	facetId: string | null;
}

export interface SidebarProps {
	views: SidebarView[];
	facets: SidebarFacet[];
	isCustomizeMode: boolean;
	onToggleCustomizeMode: () => void;
	onSearch?: (query: string) => void;
	onToggleFacet?: (facetId: string) => void;
	onReorderFacets: (facets: SidebarFacet[]) => void;
}
