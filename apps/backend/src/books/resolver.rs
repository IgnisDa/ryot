use std::sync::Arc;

use async_graphql::{Context, Error, Object, Result};
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::{
    entities::{metadata, prelude::Metadata},
    graphql::IdObject,
    media::resolver::{MediaDetails, MediaSearchResults, MediaService, SearchInput},
    migrator::{MetadataLot, MetadataSource},
    traits::MediaProvider,
};

use super::openlibrary::OpenlibraryService;

#[derive(Debug, Clone)]
pub struct BooksService {
    db: DatabaseConnection,
    openlibrary_service: Arc<OpenlibraryService>,
    media_service: Arc<MediaService>,
}

impl BooksService {
    pub fn new(
        db: &DatabaseConnection,
        openlibrary_service: &OpenlibraryService,
        media_service: &MediaService,
    ) -> Self {
        Self {
            openlibrary_service: Arc::new(openlibrary_service.clone()),
            db: db.clone(),
            media_service: Arc::new(media_service.clone()),
        }
    }
}

impl BooksService {}
