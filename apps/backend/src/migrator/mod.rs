use sea_orm::entity::prelude::*;
use sea_orm_migration::prelude::*;

mod m20230410_create_metadata;
mod m20230412_create_creator;
mod m20230413_create_person;
mod m20230417_create_user;
mod m20230419_create_seen;
mod m20230502_create_genre;
mod m20230505_create_review;
mod m20230507_create_collection;
mod m20230509_create_import_report;
mod m20230622_create_exercise;
mod m20230804_create_user_measurement;
mod m20230808_create_user_to_exercise;
mod m20230814_add_lot_field_to_exercise;
mod m20230814_add_muscles_field_to_exercise;
mod m20230819_change_exercise_structure;
mod m20230819_create_workout;
mod m20230825_create_suggestion;
mod m20230830_add_comments_field_to_review;
mod m20230901_create_metadata_group;
mod m20230901_create_partial_metadata;
mod m20230902_remove_useless_tables;
mod m20230909_add_provider_rating_field_to_metadata;
mod m20230909_add_videos_field_to_metadata;
mod m20230911_add_is_nsfw_to_metadata;
mod m20230912_add_last_processed_for_calendar_to_metadata;
mod m20230912_create_calendar_event;
mod m20230919_add_num_times_updated_field_to_seen;
mod m20230919_change_foreign_keys;
mod m20230920_add_columns_to_metadata_table;
mod m20230927_add_person_id_field_to_review;
mod m20230927_change_faulty_index_person_table;
mod m20230927_remove_useless_tables;
mod m20231003_create_partial_metadata_to_person;
mod m20231010_change_name_field_workout_table;
mod m20231012_add_source_to_exercise;
mod m20231014_remove_processed_from_exercise;

pub use m20230410_create_metadata::{Metadata, MetadataLot, MetadataSource};
pub use m20230417_create_user::{UserLot, UserToMetadata};
pub use m20230419_create_seen::{Seen, SeenState};
pub use m20230505_create_review::Review;
pub use m20230509_create_import_report::ImportSource;
pub use m20230622_create_exercise::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
    ExerciseSource,
};
pub use m20230901_create_partial_metadata::MetadataToPartialMetadataRelation;
pub use m20231003_create_partial_metadata_to_person::PersonToPartialMetadataRelation;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20230410_create_metadata::Migration),
            Box::new(m20230412_create_creator::Migration),
            Box::new(m20230413_create_person::Migration),
            Box::new(m20230417_create_user::Migration),
            Box::new(m20230419_create_seen::Migration),
            Box::new(m20230502_create_genre::Migration),
            Box::new(m20230505_create_review::Migration),
            Box::new(m20230507_create_collection::Migration),
            Box::new(m20230509_create_import_report::Migration),
            Box::new(m20230622_create_exercise::Migration),
            Box::new(m20230804_create_user_measurement::Migration),
            Box::new(m20230808_create_user_to_exercise::Migration),
            Box::new(m20230814_add_lot_field_to_exercise::Migration),
            Box::new(m20230814_add_muscles_field_to_exercise::Migration),
            Box::new(m20230819_change_exercise_structure::Migration),
            Box::new(m20230819_create_workout::Migration),
            Box::new(m20230825_create_suggestion::Migration),
            Box::new(m20230830_add_comments_field_to_review::Migration),
            Box::new(m20230901_create_metadata_group::Migration),
            Box::new(m20230902_remove_useless_tables::Migration),
            Box::new(m20230901_create_partial_metadata::Migration),
            Box::new(m20230909_add_provider_rating_field_to_metadata::Migration),
            Box::new(m20230909_add_videos_field_to_metadata::Migration),
            Box::new(m20230911_add_is_nsfw_to_metadata::Migration),
            Box::new(m20230912_add_last_processed_for_calendar_to_metadata::Migration),
            Box::new(m20230912_create_calendar_event::Migration),
            Box::new(m20230919_add_num_times_updated_field_to_seen::Migration),
            Box::new(m20230919_change_foreign_keys::Migration),
            Box::new(m20230920_add_columns_to_metadata_table::Migration),
            Box::new(m20230927_add_person_id_field_to_review::Migration),
            Box::new(m20230927_change_faulty_index_person_table::Migration),
            Box::new(m20230927_remove_useless_tables::Migration),
            Box::new(m20231003_create_partial_metadata_to_person::Migration),
            Box::new(m20231010_change_name_field_workout_table::Migration),
            Box::new(m20231012_add_source_to_exercise::Migration),
            Box::new(m20231014_remove_processed_from_exercise::Migration),
        ]
    }
}
