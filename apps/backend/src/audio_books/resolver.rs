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

use super::audible::AudibleService;

#[derive(Debug, Clone)]
pub struct AudioBooksService {
    db: DatabaseConnection,
    audible_service: Arc<AudibleService>,
    media_service: Arc<MediaService>,
}

impl AudioBooksService {
    pub fn new(
        db: &DatabaseConnection,
        audible_service: &AudibleService,
        media_service: &MediaService,
    ) -> Self {
        Self {
            audible_service: Arc::new(audible_service.clone()),
            db: db.clone(),
            media_service: Arc::new(media_service.clone()),
        }
    }
}

impl AudioBooksService {}
