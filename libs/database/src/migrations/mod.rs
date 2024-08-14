use sea_orm::entity::prelude::*;
use sea_orm_migration::prelude::*;

mod m20230409_create_extensions;
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
mod m20240619_remove_seen_from_media_reason_of_user_to_entity;
mod m20240620_add_minimum_and_maximum_progress_columns_to_integration;
mod m20240620_delete_invalid_calendar_events;
mod m20240704_add_new_preference_for_persisted_queries;
mod m20240710_remove_sequences_completely;
mod m20240711_remove_total_time_spent_from_seen;
mod m20240712_create_notification_platform;
mod m20240713_create_user_summary;
mod m20240713_zz_cleanup_v6_6_2_migrations;
mod m20240716_add_columns_to_user_table;
mod m20240717_add_columns_to_integration_and_notification_tables;
mod m20240717_zz_add_columns_to_user_table;
mod m20240719_remove_comment_from_top_level;
mod m20240722_remove_columns_from_user_table;
mod m20240723_remove_integration_columns_from_user_table;
mod m20240724_add_new_columns_to_collection_to_entity;
mod m20240724_zzz_new_generated_collection_to_entity_columns;
mod m20240730_changes_for_push_integrations;
mod m20240805_add_new_section_to_dashboard;
mod m20240810_remove_useless_columns_for_cte;
mod m20240814_aa_new_column_from_anime_calendar_events;
mod m20240814_bb_add_timestamp_column_to_calendar_event;

pub use m20230410_create_metadata::Metadata as AliasedMetadata;
pub use m20230413_create_person::Person as AliasedPerson;
pub use m20230417_create_user::User as AliasedUser;
pub use m20230419_create_seen::Seen as AliasedSeen;
pub use m20230501_create_metadata_group::MetadataGroup as AliasedMetadataGroup;
pub use m20230502_create_genre::{
    Genre as AliasedGenre, MetadataToGenre as AliasedMetadataToGenre,
};
pub use m20230504_create_collection::Collection as AliasedCollection;
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
            Box::new(m20230409_create_extensions::Migration),
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
            Box::new(m20240619_remove_seen_from_media_reason_of_user_to_entity::Migration),
            Box::new(m20240620_delete_invalid_calendar_events::Migration),
            Box::new(m20240620_add_minimum_and_maximum_progress_columns_to_integration::Migration),
            Box::new(m20240704_add_new_preference_for_persisted_queries::Migration),
            Box::new(m20240710_remove_sequences_completely::Migration),
            Box::new(m20240711_remove_total_time_spent_from_seen::Migration),
            Box::new(m20240712_create_notification_platform::Migration),
            Box::new(m20240713_create_user_summary::Migration),
            Box::new(m20240713_zz_cleanup_v6_6_2_migrations::Migration),
            Box::new(m20240716_add_columns_to_user_table::Migration),
            Box::new(m20240717_add_columns_to_integration_and_notification_tables::Migration),
            Box::new(m20240717_zz_add_columns_to_user_table::Migration),
            Box::new(m20240719_remove_comment_from_top_level::Migration),
            Box::new(m20240722_remove_columns_from_user_table::Migration),
            Box::new(m20240723_remove_integration_columns_from_user_table::Migration),
            Box::new(m20240724_add_new_columns_to_collection_to_entity::Migration),
            Box::new(m20240724_zzz_new_generated_collection_to_entity_columns::Migration),
            Box::new(m20240730_changes_for_push_integrations::Migration),
            Box::new(m20240805_add_new_section_to_dashboard::Migration),
            Box::new(m20240810_remove_useless_columns_for_cte::Migration),
            Box::new(m20240814_aa_new_column_from_anime_calendar_events::Migration),
            Box::new(m20240814_bb_add_timestamp_column_to_calendar_event::Migration),
        ]
    }
}
