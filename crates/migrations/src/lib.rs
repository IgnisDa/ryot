use sea_orm::entity::prelude::*;
use sea_orm_migration::prelude::*;

mod m20230403_create_extensions;
mod m20230404_create_user;
mod m20230410_create_metadata;
mod m20230411_create_metadata_group;
mod m20230413_create_person;
mod m20230419_create_seen;
mod m20230502_create_genre;
mod m20230504_create_collection;
mod m20230505_create_exercise;
mod m20230506_create_workout_template;
mod m20230507_create_workout;
mod m20230508_create_review;
mod m20230509_create_import_report;
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
mod m20241214_create_user_notification;
mod m20250118_is_v8_migration;
mod m20250122_changes_for_issue_1188;
mod m20250126_changes_for_issue_1201;
mod m20250201_changes_for_issue_1211;
mod m20250204_changes_for_issue_1231;
mod m20250208_changes_for_issue_1233;
mod m20250210_changes_for_issue_1217;
mod m20250210_changes_for_issue_1232;
mod m20250211_changes_for_issue_1216;
mod m20250225_changes_for_issue_1271;
mod m20250225_changes_for_issue_1274;
mod m20250310_changes_for_issue_1259;
mod m20250317_changes_for_issue_1292;
mod m20250319_changes_for_issue_1294;
mod m20250401_changes_for_issue_1326;
mod m20250402_changes_for_issue_1281;
mod m20250403_changes_for_issue_1330;
mod m20250404_changes_for_issue_1339;
mod m20250405_changes_for_issue_1347;
mod m20250423_changes_for_issue_1355;
mod m20250425_changes_for_issue_1397;
mod m20250507_changes_for_issue_1361;
mod m20250612_changes_for_issue_1401;
mod m20250614_changes_for_issue_1375;
mod m20250622_changes_for_issue_1419;
mod m20250626_changes_for_issue_1426;
mod m20250716_changes_for_issue_1470;
mod m20250723_changes_for_issue_1484;
mod m20250724_changes_for_issue_1488;
mod m20250727_changes_for_issue_1492;

pub use m20230404_create_user::User as AliasedUser;
pub use m20230410_create_metadata::Metadata as AliasedMetadata;
pub use m20230411_create_metadata_group::MetadataGroup as AliasedMetadataGroup;
pub use m20230413_create_person::Person as AliasedPerson;
pub use m20230419_create_seen::Seen as AliasedSeen;
pub use m20230502_create_genre::{
    Genre as AliasedGenre, MetadataToGenre as AliasedMetadataToGenre,
};
pub use m20230504_create_collection::Collection as AliasedCollection;
pub use m20230505_create_exercise::Exercise as AliasedExercise;
pub use m20230508_create_review::Review as AliasedReview;
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
            Box::new(m20230419_create_seen::Migration),
            Box::new(m20230502_create_genre::Migration),
            Box::new(m20230504_create_collection::Migration),
            Box::new(m20230505_create_exercise::Migration),
            Box::new(m20230506_create_workout_template::Migration),
            Box::new(m20230507_create_workout::Migration),
            Box::new(m20230508_create_review::Migration),
            Box::new(m20230509_create_import_report::Migration),
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
            Box::new(m20241214_create_user_notification::Migration),
            Box::new(m20250118_is_v8_migration::Migration),
            Box::new(m20250122_changes_for_issue_1188::Migration),
            Box::new(m20250126_changes_for_issue_1201::Migration),
            Box::new(m20250201_changes_for_issue_1211::Migration),
            Box::new(m20250204_changes_for_issue_1231::Migration),
            Box::new(m20250208_changes_for_issue_1233::Migration),
            Box::new(m20250210_changes_for_issue_1217::Migration),
            Box::new(m20250210_changes_for_issue_1232::Migration),
            Box::new(m20250211_changes_for_issue_1216::Migration),
            Box::new(m20250225_changes_for_issue_1271::Migration),
            Box::new(m20250225_changes_for_issue_1274::Migration),
            Box::new(m20250310_changes_for_issue_1259::Migration),
            Box::new(m20250317_changes_for_issue_1292::Migration),
            Box::new(m20250319_changes_for_issue_1294::Migration),
            Box::new(m20250401_changes_for_issue_1326::Migration),
            Box::new(m20250402_changes_for_issue_1281::Migration),
            Box::new(m20250403_changes_for_issue_1330::Migration),
            Box::new(m20250404_changes_for_issue_1339::Migration),
            Box::new(m20250405_changes_for_issue_1347::Migration),
            Box::new(m20250423_changes_for_issue_1355::Migration),
            Box::new(m20250507_changes_for_issue_1361::Migration),
            Box::new(m20250425_changes_for_issue_1397::Migration),
            Box::new(m20250612_changes_for_issue_1401::Migration),
            Box::new(m20250614_changes_for_issue_1375::Migration),
            Box::new(m20250622_changes_for_issue_1419::Migration),
            Box::new(m20250626_changes_for_issue_1426::Migration),
            Box::new(m20250716_changes_for_issue_1470::Migration),
            Box::new(m20250723_changes_for_issue_1484::Migration),
            Box::new(m20250724_changes_for_issue_1488::Migration),
            Box::new(m20250727_changes_for_issue_1492::Migration),
        ]
    }
}
