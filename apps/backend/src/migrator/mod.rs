use sea_orm::entity::prelude::*;
use sea_orm_migration::prelude::*;

mod m20230410_000001_create_metadata;
mod m20230417_000004_create_user;
mod m20230419_000005_create_seen;
mod m20230502_000009_create_genre;
mod m20230504_000010_create_summary;
mod m20230505_000012_create_review;
mod m20230507_000013_create_collection;
mod m20230509_000014_create_media_import_report;

pub use m20230410_000001_create_metadata::{
    Metadata, MetadataImageLot, MetadataLot, MetadataSource,
};
pub use m20230417_000004_create_user::UserLot;
pub use m20230505_000012_create_review::ReviewVisibility;
pub use m20230509_000014_create_media_import_report::MediaImportSource;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20230410_000001_create_metadata::Migration),
            Box::new(m20230417_000004_create_user::Migration),
            Box::new(m20230419_000005_create_seen::Migration),
            Box::new(m20230502_000009_create_genre::Migration),
            Box::new(m20230504_000010_create_summary::Migration),
            Box::new(m20230505_000012_create_review::Migration),
            Box::new(m20230507_000013_create_collection::Migration),
            Box::new(m20230509_000014_create_media_import_report::Migration),
        ]
    }
}
