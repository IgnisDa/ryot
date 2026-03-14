export interface SidebarEntitySchema {
	id: string;
	name: string;
	slug: string;
}

export interface SidebarFacet {
	id: string;
	slug: string;
	name: string;
	enabled: boolean;
	sortOrder: number;
	icon?: string | null;
	isExpanded?: boolean;
	accentColor?: string | null;
	entitySchemas: SidebarEntitySchema[];
}

export interface SidebarView {
	id: string;
	name: string;
	slug: string;
	icon?: string | null;
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
