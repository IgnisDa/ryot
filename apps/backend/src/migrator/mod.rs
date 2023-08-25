use sea_orm::entity::prelude::*;
use sea_orm_migration::prelude::*;

mod m20230410_create_metadata;
mod m20230412_create_creator;
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
mod m20230825_drop_stuff;

pub use m20230410_create_metadata::{Metadata, MetadataImageLot, MetadataLot, MetadataSource};
pub use m20230417_create_user::{UserLot, UserToMetadata};
pub use m20230419_create_seen::{Seen, SeenState};
pub use m20230505_create_review::Review;
pub use m20230509_create_import_report::ImportSource;
pub use m20230622_create_exercise::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
};

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20230410_create_metadata::Migration),
            Box::new(m20230412_create_creator::Migration),
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
            Box::new(m20230825_drop_stuff::Migration),
        ]
    }
}
