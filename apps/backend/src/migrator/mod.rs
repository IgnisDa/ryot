use sea_orm_migration::prelude::*;

mod m20230410_000001_create_metadata_image;
mod m20230410_000002_create_metadata;
mod m20230416_000003_create_books;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20230410_000001_create_metadata_image::Migration),
            Box::new(m20230410_000002_create_metadata::Migration),
            Box::new(m20230416_000003_create_books::Migration),
        ]
    }
}

pub use m20230410_000001_create_metadata_image::MediaItemMetadataImageLot;
pub use m20230410_000002_create_metadata::MediaItemLot;
pub use m20230416_000003_create_books::Book;
