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
mod m20230622_create_exercise;
mod m20230804_create_user_measurement;
mod m20230819_create_workout;
mod m20230901_create_partial_metadata;
mod m20230912_create_calendar_event;
mod m20231003_create_partial_metadata_to_person;
mod m20231016_create_collection_to_entity;
mod m20231017_create_user_to_entity;
mod m20231219_change_column_types;
mod m20231219_create_metadata_relations;
mod m20231220_store_partial_metadata_in_metadata;
mod m20231221_drop_useless_tables;
mod m20231226_add_character_column;
mod m20231231_change_import_report_types;
mod m20240105_add_repeated_from_column;
mod m20240109_remove_persons;
mod m20240112_add_metadata_units_consumed_column;
mod m20240112_change_num_times_interacted;
mod m20240121_add_updated_at_to_seen;
mod m20240121_remove_useless_section_from_dashboard;
mod m20240122_remove_useless_section_from_dashboard;
mod m20240126_set_comment_to_null_for_measurements;
mod m20240128_change_calendar_event_data;
mod m20240128_migrate_anime_seen;
mod m20240128_migrate_manga_seen;
mod m20240202_0_normalize_seen_data;
mod m20240202_1_normalize_calendar_events_data;
mod m20240202_2_normalize_reviews_data;
mod m20240202_3_add_metadata_reason;
mod m20240202_4_normalize_metadata_data;
mod m20240202_5_remove_default_value;
mod m20240202_6_remove_last_processed_on_for_calendar;

pub use m20230410_create_metadata::{Metadata as AliasedMetadata, MetadataLot, MetadataSource};
pub use m20230413_create_person::Person as AliasedPerson;
pub use m20230417_create_user::UserLot;
pub use m20230419_create_seen::{Seen as AliasedSeen, SeenState};
pub use m20230501_create_metadata_group::MetadataGroup as AliasedMetadataGroup;
pub use m20230502_create_genre::{
    Genre as AliasedGenre, MetadataToGenre as AliasedMetadataToGenre,
};
pub use m20230505_create_review::{Review as AliasedReview, Visibility};
pub use m20230509_create_import_report::ImportSource;
pub use m20230622_create_exercise::{
    Exercise as AliasedExercise, ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot,
    ExerciseMechanic, ExerciseMuscle, ExerciseSource,
};
pub use m20231017_create_user_to_entity::UserToEntity as AliasedUserToEntity;
pub use m20231219_create_metadata_relations::MetadataToMetadataRelation;

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
            Box::new(m20230622_create_exercise::Migration),
            Box::new(m20230804_create_user_measurement::Migration),
            Box::new(m20230819_create_workout::Migration),
            Box::new(m20230901_create_partial_metadata::Migration),
            Box::new(m20230912_create_calendar_event::Migration),
            Box::new(m20231003_create_partial_metadata_to_person::Migration),
            Box::new(m20231016_create_collection_to_entity::Migration),
            Box::new(m20231017_create_user_to_entity::Migration),
            Box::new(m20231219_change_column_types::Migration),
            Box::new(m20231219_create_metadata_relations::Migration),
            Box::new(m20231220_store_partial_metadata_in_metadata::Migration),
            Box::new(m20231221_drop_useless_tables::Migration),
            Box::new(m20231226_add_character_column::Migration),
            Box::new(m20231231_change_import_report_types::Migration),
            Box::new(m20240105_add_repeated_from_column::Migration),
            Box::new(m20240109_remove_persons::Migration),
            Box::new(m20240112_add_metadata_units_consumed_column::Migration),
            Box::new(m20240112_change_num_times_interacted::Migration),
            Box::new(m20240121_add_updated_at_to_seen::Migration),
            Box::new(m20240121_remove_useless_section_from_dashboard::Migration),
            Box::new(m20240122_remove_useless_section_from_dashboard::Migration),
            Box::new(m20240126_set_comment_to_null_for_measurements::Migration),
            Box::new(m20240128_change_calendar_event_data::Migration),
            Box::new(m20240128_migrate_anime_seen::Migration),
            Box::new(m20240128_migrate_manga_seen::Migration),
            Box::new(m20240202_0_normalize_seen_data::Migration),
            Box::new(m20240202_1_normalize_calendar_events_data::Migration),
            Box::new(m20240202_2_normalize_reviews_data::Migration),
            Box::new(m20240202_4_normalize_metadata_data::Migration),
            Box::new(m20240202_3_add_metadata_reason::Migration),
            Box::new(m20240202_5_remove_default_value::Migration),
            Box::new(m20240202_6_remove_last_processed_on_for_calendar::Migration),
        ]
    }
}
