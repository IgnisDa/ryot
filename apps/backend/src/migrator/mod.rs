use sea_orm::entity::prelude::*;
use sea_orm_migration::prelude::*;

mod m20230410_000001_create_metadata;
mod m20230417_000002_create_user;
mod m20230419_000003_create_seen;
mod m20230502_000004_create_genre;
mod m20230504_000005_create_summary;
mod m20230505_000006_create_review;
mod m20230507_000007_create_collection;
mod m20230509_000008_create_media_import_report;
mod m20230612_000009_add_dropped_field;
mod m20230614_000010_add_user_preferences_field;
mod m20230616_000011_remove_goodreads_source;

pub use m20230410_000001_create_metadata::{
    Metadata, MetadataImageLot, MetadataLot, MetadataSource,
};
pub use m20230417_000002_create_user::UserLot;
pub use m20230505_000006_create_review::ReviewVisibility;
pub use m20230509_000008_create_media_import_report::MediaImportSource;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20230410_000001_create_metadata::Migration),
            Box::new(m20230417_000002_create_user::Migration),
            Box::new(m20230419_000003_create_seen::Migration),
            Box::new(m20230502_000004_create_genre::Migration),
            Box::new(m20230504_000005_create_summary::Migration),
            Box::new(m20230505_000006_create_review::Migration),
            Box::new(m20230507_000007_create_collection::Migration),
            Box::new(m20230509_000008_create_media_import_report::Migration),
            Box::new(m20230612_000009_add_dropped_field::Migration),
            Box::new(m20230614_000010_add_user_preferences_field::Migration),
            Box::new(m20230616_000011_remove_goodreads_source::Migration),
        ]
    }
}
