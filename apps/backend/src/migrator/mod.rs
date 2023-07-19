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
mod m20230621_000012_add_metadata_unique_index;
mod m20230622_000013_create_exercise;
mod m20230702_000014_add_user_integrations_field;
mod m20230707_000015_add_description_and_visibility_fields;
mod m20230712_000016_remove_identifier_fields;
mod m20230717_000017_change_rating_value;
mod m20230717_000018_add_user_sink_integrations_field;

pub use m20230410_000001_create_metadata::{
    Metadata, MetadataImageLot, MetadataLot, MetadataSource,
};
pub use m20230417_000002_create_user::{UserLot, UserToMetadata};
pub use m20230419_000003_create_seen::Seen;
pub use m20230505_000006_create_review::Review;
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
            Box::new(m20230621_000012_add_metadata_unique_index::Migration),
            Box::new(m20230622_000013_create_exercise::Migration),
            Box::new(m20230702_000014_add_user_integrations_field::Migration),
            Box::new(m20230707_000015_add_description_and_visibility_fields::Migration),
            Box::new(m20230712_000016_remove_identifier_fields::Migration),
            Box::new(m20230717_000017_change_rating_value::Migration),
            Box::new(m20230717_000018_add_user_sink_integrations_field::Migration),
        ]
    }
}
