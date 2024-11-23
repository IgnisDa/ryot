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
mod m20230818_create_workout_template;
mod m20230819_create_workout;
mod m20230820_create_user_measurement;
mod m20230822_create_exercise;
mod m20230912_create_calendar_event;
mod m20231016_create_collection_to_entity;
mod m20231017_create_user_to_entity;
mod m20231219_create_metadata_relations;
mod m20240509_create_user_to_collection;
mod m20240531_create_queued_notification;
mod m20240607_create_integration;
mod m20240712_create_notification_platform;
mod m20240713_create_user_summary;
mod m20240714_create_access_link;
mod m20240825_is_v7_migration;
mod m20240827_create_daily_user_activity;
mod m20240827_zz_changes_for_daily_user_activity;
mod m20240828_add_last_login_on_column_to_user;
mod m20240828_zz_add_columns_to_daily_user_activity;
mod m20240829_change_structure_for_exercise_extra_information;
mod m20240831_add_is_account_default_column_to_access_link;
mod m20240831_add_templates_key_to_preferences;
mod m20240903_add_changes_for_user_to_collection_removal;
mod m20240904_create_monitored_entity;
mod m20240918_add_default_rest_timer_to_workout_template;
mod m20240923_remove_extra_columns_for_daily_user_activities;
mod m20240926_add_columns_for_open_sourcing_pro_version;
mod m20240928_add_grid_packing_to_general_preferences;
mod m20241002_add_columns_for_associating_seen_with_reviews;
mod m20241004_create_application_cache;
mod m20241006_changes_for_issue_1056;
mod m20241010_changes_for_issue_708;
mod m20241013_changes_for_issue_1052;
mod m20241019_changes_for_issue_929;
mod m20241019_changes_for_issue_964;
mod m20241025_changes_for_issue_1084;
mod m20241110_changes_for_issue_1103;
mod m20241121_changes_for_issue_445;

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
pub use m20230912_create_calendar_event::CalendarEvent as AliasedCalendarEvent;
pub use m20231016_create_collection_to_entity::CollectionToEntity as AliasedCollectionToEntity;
pub use m20231017_create_user_to_entity::UserToEntity as AliasedUserToEntity;

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
            Box::new(m20230822_create_exercise::Migration),
            Box::new(m20230818_create_workout_template::Migration),
            Box::new(m20230819_create_workout::Migration),
            Box::new(m20230505_create_review::Migration),
            Box::new(m20230509_create_import_report::Migration),
            Box::new(m20230820_create_user_measurement::Migration),
            Box::new(m20230912_create_calendar_event::Migration),
            Box::new(m20231016_create_collection_to_entity::Migration),
            Box::new(m20231017_create_user_to_entity::Migration),
            Box::new(m20231219_create_metadata_relations::Migration),
            Box::new(m20240509_create_user_to_collection::Migration),
            Box::new(m20240531_create_queued_notification::Migration),
            Box::new(m20240607_create_integration::Migration),
            Box::new(m20240712_create_notification_platform::Migration),
            Box::new(m20240713_create_user_summary::Migration),
            Box::new(m20240714_create_access_link::Migration),
            Box::new(m20240825_is_v7_migration::Migration),
            Box::new(m20240827_create_daily_user_activity::Migration),
            Box::new(m20240827_zz_changes_for_daily_user_activity::Migration),
            Box::new(m20240828_add_last_login_on_column_to_user::Migration),
            Box::new(m20240828_zz_add_columns_to_daily_user_activity::Migration),
            Box::new(m20240829_change_structure_for_exercise_extra_information::Migration),
            Box::new(m20240831_add_templates_key_to_preferences::Migration),
            Box::new(m20240831_add_is_account_default_column_to_access_link::Migration),
            Box::new(m20240903_add_changes_for_user_to_collection_removal::Migration),
            Box::new(m20240904_create_monitored_entity::Migration),
            Box::new(m20240918_add_default_rest_timer_to_workout_template::Migration),
            Box::new(m20240923_remove_extra_columns_for_daily_user_activities::Migration),
            Box::new(m20240926_add_columns_for_open_sourcing_pro_version::Migration),
            Box::new(m20240928_add_grid_packing_to_general_preferences::Migration),
            Box::new(m20241002_add_columns_for_associating_seen_with_reviews::Migration),
            Box::new(m20241004_create_application_cache::Migration),
            Box::new(m20241006_changes_for_issue_1056::Migration),
            Box::new(m20241010_changes_for_issue_708::Migration),
            Box::new(m20241013_changes_for_issue_1052::Migration),
            Box::new(m20241019_changes_for_issue_929::Migration),
            Box::new(m20241019_changes_for_issue_964::Migration),
            Box::new(m20241025_changes_for_issue_1084::Migration),
            Box::new(m20241110_changes_for_issue_1103::Migration),
            Box::new(m20241121_changes_for_issue_445::Migration),
        ]
    }
}
