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
mod m20240210_0_remove_duplicated_calendar_events;
mod m20240210_1_create_correct_calendar_event_index;
mod m20240220_add_is_demo_column;
mod m20240223_add_is_partial_field_to_person;
mod m20240224_0_add_created_on_field_to_user_to_entity;
mod m20240224_1_change_varchar_to_text;
mod m20240224_2_change_metadata_reason_to_media_reason;
mod m20240224_3_add_person_id_column_to_user_to_entity;
mod m20240224_4_schema_changes;
mod m20240224_5_migrate_user_to_person_entries;
mod m20240225_0_change_metadata_monitored_to_media_monitored;
mod m20240225_1_change_metadata_reminder_to_media_reminder;
mod m20240226_add_needs_to_be_updated_field;
mod m20240227_add_user_to_entity_constraint;
mod m20240229_change_user_notifications_data_storage;
mod m20240302_monitor_media_in_progress_or_watchlist;
mod m20240307_add_column_to_metadata_for_watch_providers;
mod m20240309_change_generic_to_media_json;
mod m20240310_add_source_specifics_field_to_person;
mod m20240324_perform_v4_migration;
mod m20240325_add_correct_attribute_to_user_preferences;
mod m20240326_0_add_metadata_group_id_column_to_user_to_entity;
mod m20240326_1_add_user_to_entity_constraint;
mod m20240326_2_migrate_user_to_metadata_group_entries;
mod m20240326_3_change_metadata_ownership_to_media_ownership;
mod m20240327_add_new_preferences;
mod m20240330_add_is_partial_field_to_metadata_group;
mod m20240401_0_change_seen_progress_type;
mod m20240401_1_add_provider_watched_on_to_seen;
mod m20240401_2_add_watch_providers_preferences;
mod m20240402_0_create_monitored_collection_for_existing_users;
mod m20240402_1_create_collection_to_entity_entries_for_monitoring_media;
mod m20240402_2_drop_media_monitored_column_from_user_to_entity;
mod m20240402_3_change_name_of_reason;
mod m20240403_add_total_time_spent_column_to_seen;
mod m20240408_0_add_disable_reviews_to_preferences;
mod m20240408_1_add_oidc_issuer_id_to_user;
mod m20240408_2_cleanup_user;
mod m20240410_change_unique_constraints_to_indices;

pub use m20230410_create_metadata::Metadata as AliasedMetadata;
pub use m20230413_create_person::Person as AliasedPerson;
pub use m20230419_create_seen::Seen as AliasedSeen;
pub use m20230501_create_metadata_group::MetadataGroup as AliasedMetadataGroup;
pub use m20230502_create_genre::{
    Genre as AliasedGenre, MetadataToGenre as AliasedMetadataToGenre,
};
pub use m20230505_create_review::Review as AliasedReview;
pub use m20230622_create_exercise::Exercise as AliasedExercise;
pub use m20231017_create_user_to_entity::UserToEntity as AliasedUserToEntity;

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
            Box::new(m20240210_0_remove_duplicated_calendar_events::Migration),
            Box::new(m20240210_1_create_correct_calendar_event_index::Migration),
            Box::new(m20240220_add_is_demo_column::Migration),
            Box::new(m20240223_add_is_partial_field_to_person::Migration),
            Box::new(m20240224_0_add_created_on_field_to_user_to_entity::Migration),
            Box::new(m20240224_1_change_varchar_to_text::Migration),
            Box::new(m20240224_2_change_metadata_reason_to_media_reason::Migration),
            Box::new(m20240224_3_add_person_id_column_to_user_to_entity::Migration),
            Box::new(m20240224_5_migrate_user_to_person_entries::Migration),
            Box::new(m20240224_4_schema_changes::Migration),
            Box::new(m20240225_0_change_metadata_monitored_to_media_monitored::Migration),
            Box::new(m20240225_1_change_metadata_reminder_to_media_reminder::Migration),
            Box::new(m20240226_add_needs_to_be_updated_field::Migration),
            Box::new(m20240227_add_user_to_entity_constraint::Migration),
            Box::new(m20240229_change_user_notifications_data_storage::Migration),
            Box::new(m20240302_monitor_media_in_progress_or_watchlist::Migration),
            Box::new(m20240307_add_column_to_metadata_for_watch_providers::Migration),
            Box::new(m20240309_change_generic_to_media_json::Migration),
            Box::new(m20240310_add_source_specifics_field_to_person::Migration),
            Box::new(m20240324_perform_v4_migration::Migration),
            Box::new(m20240325_add_correct_attribute_to_user_preferences::Migration),
            Box::new(m20240326_0_add_metadata_group_id_column_to_user_to_entity::Migration),
            Box::new(m20240326_1_add_user_to_entity_constraint::Migration),
            Box::new(m20240326_2_migrate_user_to_metadata_group_entries::Migration),
            Box::new(m20240326_3_change_metadata_ownership_to_media_ownership::Migration),
            Box::new(m20240327_add_new_preferences::Migration),
            Box::new(m20240330_add_is_partial_field_to_metadata_group::Migration),
            Box::new(m20240401_0_change_seen_progress_type::Migration),
            Box::new(m20240401_1_add_provider_watched_on_to_seen::Migration),
            Box::new(m20240401_2_add_watch_providers_preferences::Migration),
            Box::new(m20240402_0_create_monitored_collection_for_existing_users::Migration),
            Box::new(
                m20240402_1_create_collection_to_entity_entries_for_monitoring_media::Migration,
            ),
            Box::new(m20240402_2_drop_media_monitored_column_from_user_to_entity::Migration),
            Box::new(m20240402_3_change_name_of_reason::Migration),
            Box::new(m20240403_add_total_time_spent_column_to_seen::Migration),
            Box::new(m20240408_0_add_disable_reviews_to_preferences::Migration),
            Box::new(m20240408_1_add_oidc_issuer_id_to_user::Migration),
            Box::new(m20240408_2_cleanup_user::Migration),
            Box::new(m20240410_change_unique_constraints_to_indices::Migration),
        ]
    }
}
