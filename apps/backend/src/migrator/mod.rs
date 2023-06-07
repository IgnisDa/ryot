use sea_orm::entity::prelude::*;
use sea_orm_migration::prelude::*;

mod m20230410_000001_create_metadata;
mod m20230416_000002_create_creator;
mod m20230416_000003_create_book;
mod m20230417_000004_create_user;
mod m20230419_000005_create_seen;
mod m20230423_000006_create_movie;
mod m20230425_000007_create_show;
mod m20230502_000008_create_video_game;
mod m20230502_000009_create_genre;
mod m20230504_000010_create_summary;
mod m20230504_000011_create_audio_book;
mod m20230505_000012_create_review;
mod m20230507_000013_create_collection;
mod m20230509_000014_create_media_import_report;
mod m20230514_000015_create_podcast;
mod m20230531_000016_embed_creators;
mod m20230531_000017_drop_creator_tables;
mod m20230602_000018_drop_token_tables;
mod m20230603_000019_change_images_format;
mod m20230605_000020_add_platform_field;
mod m20230607_000021_hoist_source;
mod m20230607_000022_hoist_media_details;
mod m20230607_000023_drop_specifics_tables;

pub use m20230410_000001_create_metadata::{Metadata, MetadataImageLot, MetadataLot};
pub use m20230416_000002_create_creator::Creator;
pub use m20230416_000003_create_book::{Book, BookSource};
pub use m20230417_000004_create_user::{TokenLot, UserLot};
pub use m20230423_000006_create_movie::MovieSource;
pub use m20230425_000007_create_show::ShowSource;
pub use m20230502_000008_create_video_game::VideoGameSource;
pub use m20230504_000011_create_audio_book::AudioBookSource;
pub use m20230505_000012_create_review::ReviewVisibility;
pub use m20230509_000014_create_media_import_report::MediaImportSource;
pub use m20230514_000015_create_podcast::PodcastSource;
pub use m20230607_000021_hoist_source::MetadataSource;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20230410_000001_create_metadata::Migration),
            Box::new(m20230416_000002_create_creator::Migration),
            Box::new(m20230416_000003_create_book::Migration),
            Box::new(m20230417_000004_create_user::Migration),
            Box::new(m20230419_000005_create_seen::Migration),
            Box::new(m20230423_000006_create_movie::Migration),
            Box::new(m20230425_000007_create_show::Migration),
            Box::new(m20230502_000008_create_video_game::Migration),
            Box::new(m20230502_000009_create_genre::Migration),
            Box::new(m20230504_000010_create_summary::Migration),
            Box::new(m20230504_000011_create_audio_book::Migration),
            Box::new(m20230505_000012_create_review::Migration),
            Box::new(m20230507_000013_create_collection::Migration),
            Box::new(m20230509_000014_create_media_import_report::Migration),
            Box::new(m20230514_000015_create_podcast::Migration),
            Box::new(m20230531_000016_embed_creators::Migration),
            Box::new(m20230531_000017_drop_creator_tables::Migration),
            Box::new(m20230602_000018_drop_token_tables::Migration),
            Box::new(m20230603_000019_change_images_format::Migration),
            Box::new(m20230605_000020_add_platform_field::Migration),
            Box::new(m20230607_000021_hoist_source::Migration),
            Box::new(m20230607_000022_hoist_media_details::Migration),
            Box::new(m20230607_000023_drop_specifics_tables::Migration),
        ]
    }
}
