use sea_orm::entity::prelude::*;
use sea_orm_migration::prelude::*;

mod m20230403_create_extensions;
mod m20230404_create_user;
mod m20230410_create_metadata;
mod m20230411_create_metadata_group;
mod m20230413_create_person;
mod m20230502_create_genre;
mod m20230504_create_collection;
mod m20230505_create_exercise;
mod m20230506_create_workout_template;
mod m20230507_create_workout;
mod m20230508_create_review;
mod m20230510_create_seen;
mod m20230513_create_import_report;
mod m20230820_create_user_measurement;
mod m20230912_create_calendar_event;
mod m20231016_create_collection_to_entity;
mod m20231017_create_user_to_entity;
mod m20231219_create_metadata_relations;
mod m20240607_create_integration;
mod m20240712_create_notification_platform;
mod m20240714_create_access_link;
mod m20240827_create_daily_user_activity;
mod m20240904_create_monitored_entity;
mod m20241004_create_application_cache;
mod m20250801_is_v9_migration;
mod m20250813_create_collection_entity_membership;
mod m20250814_changes_for_issue_1483;
mod m20250826_changes_for_issue_1529;

pub use m20230404_create_user::User as AliasedUser;
pub use m20230410_create_metadata::Metadata as AliasedMetadata;
pub use m20230411_create_metadata_group::MetadataGroup as AliasedMetadataGroup;
pub use m20230413_create_person::Person as AliasedPerson;
pub use m20230502_create_genre::{
    Genre as AliasedGenre, MetadataToGenre as AliasedMetadataToGenre,
};
pub use m20230504_create_collection::Collection as AliasedCollection;
pub use m20230505_create_exercise::Exercise as AliasedExercise;
pub use m20230508_create_review::Review as AliasedReview;
pub use m20230510_create_seen::Seen as AliasedSeen;
pub use m20230912_create_calendar_event::CalendarEvent as AliasedCalendarEvent;
pub use m20231016_create_collection_to_entity::CollectionToEntity as AliasedCollectionToEntity;
pub use m20231017_create_user_to_entity::UserToEntity as AliasedUserToEntity;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20230403_create_extensions::Migration),
            Box::new(m20230404_create_user::Migration),
            Box::new(m20230410_create_metadata::Migration),
            Box::new(m20230411_create_metadata_group::Migration),
            Box::new(m20230413_create_person::Migration),
            Box::new(m20230502_create_genre::Migration),
            Box::new(m20230504_create_collection::Migration),
            Box::new(m20230505_create_exercise::Migration),
            Box::new(m20230506_create_workout_template::Migration),
            Box::new(m20230507_create_workout::Migration),
            Box::new(m20230508_create_review::Migration),
            Box::new(m20230510_create_seen::Migration),
            Box::new(m20230513_create_import_report::Migration),
            Box::new(m20230820_create_user_measurement::Migration),
            Box::new(m20230912_create_calendar_event::Migration),
            Box::new(m20231016_create_collection_to_entity::Migration),
            Box::new(m20231017_create_user_to_entity::Migration),
            Box::new(m20231219_create_metadata_relations::Migration),
            Box::new(m20240607_create_integration::Migration),
            Box::new(m20240712_create_notification_platform::Migration),
            Box::new(m20240714_create_access_link::Migration),
            Box::new(m20240827_create_daily_user_activity::Migration),
            Box::new(m20240904_create_monitored_entity::Migration),
            Box::new(m20241004_create_application_cache::Migration),
            Box::new(m20250801_is_v9_migration::Migration),
            Box::new(m20250813_create_collection_entity_membership::Migration),
            Box::new(m20250814_changes_for_issue_1483::Migration),
            Box::new(m20250826_changes_for_issue_1529::Migration),
        ]
    }
}
