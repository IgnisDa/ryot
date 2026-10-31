type RelationshipDirection = "parent" | "outgoing" | "incoming";

export const relationshipEnds = (direction: RelationshipDirection) =>
	direction === "outgoing"
		? ({ anchor: "source", related: "target" } as const)
		: ({ anchor: "target", related: "source" } as const);

export const orientRelationship = <Id>(
	direction: RelationshipDirection,
	anchorEntityId: Id,
	relatedEntityId: Id,
) =>
	direction === "outgoing"
		? { sourceEntityId: anchorEntityId, targetEntityId: relatedEntityId }
		: { targetEntityId: anchorEntityId, sourceEntityId: relatedEntityId };
