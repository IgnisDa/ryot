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
mod m20230912_create_calendar_event;
mod m20231016_create_collection_to_entity;
mod m20231017_create_user_to_entity;
mod m20231219_create_metadata_relations;
mod m20240415_is_v5_migration;
mod m20240416_change_json_to_generic_json;
mod m20240425_add_created_by_user_id_column_to_execise;
mod m20240503_update_user_to_entity_to_recalculate;
mod m20240504_add_columns_for_state_changes;
mod m20240506_0_add_done_collection_for_existing_users;
mod m20240506_1_add_entities_to_done_collection_for_existing_users;
mod m20240507_0_remove_visibility_from_collection;
mod m20240508_set_state_changes_to_null;
mod m20240509_create_user_to_collection;
mod m20240509_q_associate_collections_with_owners;
mod m20240510_0_add_information_template_to_collection;
mod m20240510_1_port_owned_information;
mod m20240511_port_reminders_to_information;

pub use m20230410_create_metadata::Metadata as AliasedMetadata;
pub use m20230413_create_person::Person as AliasedPerson;
pub use m20230419_create_seen::Seen as AliasedSeen;
pub use m20230501_create_metadata_group::MetadataGroup as AliasedMetadataGroup;
pub use m20230502_create_genre::{
    Genre as AliasedGenre, MetadataToGenre as AliasedMetadataToGenre,
};
pub use m20230505_create_review::Review as AliasedReview;
pub use m20230622_create_exercise::Exercise as AliasedExercise;
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
            Box::new(m20230622_create_exercise::Migration),
            Box::new(m20230804_create_user_measurement::Migration),
            Box::new(m20230819_create_workout::Migration),
            Box::new(m20230912_create_calendar_event::Migration),
            Box::new(m20231016_create_collection_to_entity::Migration),
            Box::new(m20231017_create_user_to_entity::Migration),
            Box::new(m20231219_create_metadata_relations::Migration),
            Box::new(m20240415_is_v5_migration::Migration),
            Box::new(m20240416_change_json_to_generic_json::Migration),
            Box::new(m20240425_add_created_by_user_id_column_to_execise::Migration),
            Box::new(m20240503_update_user_to_entity_to_recalculate::Migration),
            Box::new(m20240504_add_columns_for_state_changes::Migration),
            Box::new(m20240506_0_add_done_collection_for_existing_users::Migration),
            Box::new(m20240506_1_add_entities_to_done_collection_for_existing_users::Migration),
            Box::new(m20240507_0_remove_visibility_from_collection::Migration),
            Box::new(m20240508_set_state_changes_to_null::Migration),
            Box::new(m20240509_create_user_to_collection::Migration),
            Box::new(m20240509_q_associate_collections_with_owners::Migration),
            Box::new(m20240510_0_add_information_template_to_collection::Migration),
            Box::new(m20240510_1_port_owned_information::Migration),
            Box::new(m20240511_port_reminders_to_information::Migration),
        ]
    }
}
