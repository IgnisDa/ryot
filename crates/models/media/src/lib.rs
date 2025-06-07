// Module declarations and re-exports for media models
mod authentication;
mod collections;
mod core_models;
mod graphql_types;
mod import_export;
mod integrations;
mod media_specifics;
mod metadata_models;
mod user_interactions;

pub use authentication::*;
pub use collections::*;
pub use core_models::*;
pub use graphql_types::*;
pub use import_export::*;
pub use integrations::*;
pub use media_specifics::*;
pub use metadata_models::*;
pub use user_interactions::*;

// EntityWithLot moved to metadata_models.rs

// CreateOrUpdateCollectionInput moved to collections.rs

// GenreListItem moved to metadata_models.rs

// MovieSpecifics moved to media_specifics.rs

// Metadata search items moved to metadata_models.rs

// CreateOrUpdateReviewInput and ProgressUpdateInput moved to graphql_types.rs

// ProgressUpdateErrorVariant, ProgressUpdateError, and ProgressUpdateResultUnion moved to graphql_types.rs

// PartialMetadataPerson, WatchProvider, MetadataExternalIdentifiers moved to metadata_models.rs

// MetadataDetails moved to metadata_models.rs

// Import/Export structs moved to import_export.rs

// MetadataFreeCreator moved to metadata_models.rs

// Seen* structs moved to user_interactions.rs

// PartialMetadata and CommitPersonInput moved to metadata_models.rs

// MetadataGroupSearchItem, UniqueMediaIdentifier, CommitMetadataGroupInput moved to metadata_models.rs

// State changes structs moved to user_interactions.rs

// Integration structs moved to integrations.rs

// ReviewItem moved to core_models.rs

// Deploy import structs moved to import_export.rs

// CreateCustomMetadataInput and UpdateCustomMetadataInput moved to metadata_models.rs

// Integration and notification structs moved to integrations.rs

// Authentication structs moved to authentication.rs

// GenreDetailsInput moved to graphql_types.rs

// Collection structs moved to collections.rs

// MetadataCreator and MetadataCreatorGroupedByRole moved to metadata_models.rs

// Person details structs moved to core_models.rs

// GraphqlMetadataGroup and GraphqlMetadataDetails moved to metadata_models.rs

// GraphQL enums and filters moved to graphql_types.rs

// GraphQL UI structs moved to graphql_types.rs

// OidcTokenOutput moved to authentication.rs

// Calendar and access link structs moved to graphql_types.rs and authentication.rs
