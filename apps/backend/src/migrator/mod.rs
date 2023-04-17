use sea_orm_migration::prelude::*;

mod m20230410_000001_create_metadata;
mod m20230416_000002_create_creator;
mod m20230416_000003_create_book;
mod m20230417_000004_create_user;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20230410_000001_create_metadata::Migration),
            Box::new(m20230416_000002_create_creator::Migration),
            Box::new(m20230416_000003_create_book::Migration),
            Box::new(m20230417_000004_create_user::Migration),
        ]
    }
}

pub use m20230410_000001_create_metadata::{
    MediaItemLot, MediaItemMetadata, MediaItemMetadataImageLot,
};
pub use m20230416_000002_create_creator::Creator;
pub use m20230416_000003_create_book::Book;
