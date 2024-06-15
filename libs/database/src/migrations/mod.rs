use sea_orm::entity::prelude::*;
use sea_orm_migration::prelude::*;

mod m20230410_create_metadata;
mod m20230413_create_person;
mod m20230417_create_user;
mod m20230419_create_seen;
mod m20230501_create_metadata_group;
mod m20230502_create_genre;
mod m20230504_create_collection;
mod m20230505_create_review;
mod m20230509_create_import_report;
mod m20230819_create_workout;
mod m20230820_create_user_measurement;
mod m20230822_create_exercise;
mod m20230912_create_calendar_event;
mod m20231016_create_collection_to_entity;
mod m20231017_create_user_to_entity;
mod m20231219_create_metadata_relations;
mod m20240509_create_user_to_collection;
mod m20240531_create_queued_notification;
mod m20240606_is_v6_migration;
mod m20240607_change_boolean_column_names;
mod m20240607_change_user_primary_key;
mod m20240607_create_integration;
mod m20240608_add_created_on_column_to_collection_to_entity;

pub use m20230410_create_metadata::Metadata as AliasedMetadata;
pub use m20230413_create_person::Person as AliasedPerson;
pub use m20230419_create_seen::Seen as AliasedSeen;
pub use m20230501_create_metadata_group::MetadataGroup as AliasedMetadataGroup;
pub use m20230502_create_genre::{
    Genre as AliasedGenre, MetadataToGenre as AliasedMetadataToGenre,
};
pub use m20230505_create_review::Review as AliasedReview;
pub use m20230822_create_exercise::Exercise as AliasedExercise;
pub use m20231016_create_collection_to_entity::CollectionToEntity as AliasedCollectionToEntity;
pub use m20231017_create_user_to_entity::UserToEntity as AliasedUserToEntity;
pub use m20240509_create_user_to_collection::UserToCollection as AliasedUserToCollection;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20230410_create_metadata::Migration),
            Box::new(m20230413_create_person::Migration),
            Box::new(m20230417_create_user::Migration),
            Box::new(m20230419_create_seen::Migration),
            Box::new(m20230501_create_metadata_group::Migration),
            Box::new(m20230502_create_genre::Migration),
            Box::new(m20230504_create_collection::Migration),
            Box::new(m20230505_create_review::Migration),
            Box::new(m20230509_create_import_report::Migration),
            Box::new(m20230819_create_workout::Migration),
            Box::new(m20230820_create_user_measurement::Migration),
            Box::new(m20230822_create_exercise::Migration),
            Box::new(m20230912_create_calendar_event::Migration),
            Box::new(m20231016_create_collection_to_entity::Migration),
            Box::new(m20231017_create_user_to_entity::Migration),
            Box::new(m20231219_create_metadata_relations::Migration),
            Box::new(m20240509_create_user_to_collection::Migration),
            Box::new(m20240531_create_queued_notification::Migration),
            Box::new(m20240606_is_v6_migration::Migration),
            Box::new(m20240607_change_boolean_column_names::Migration),
            Box::new(m20240607_change_user_primary_key::Migration),
            Box::new(m20240607_create_integration::Migration),
            Box::new(m20240608_add_created_on_column_to_collection_to_entity::Migration),
        ]
    }
}
