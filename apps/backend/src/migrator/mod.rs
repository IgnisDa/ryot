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

pub use m20230410_create_metadata::{Metadata, MetadataImageLot, MetadataLot, MetadataSource};
pub use m20230417_create_user::{UserLot, UserToMetadata};
pub use m20230419_create_seen::{Seen, SeenState};
pub use m20230505_create_review::Review;
pub use m20230509_create_import_report::ImportSource;

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
        ]
    }
}
