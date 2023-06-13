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

use super::tmdb::TmdbService;

#[derive(Debug, Clone)]
pub struct ShowsService {
    db: DatabaseConnection,
    tmdb_service: Arc<TmdbService>,
    media_service: Arc<MediaService>,
}

impl ShowsService {
    pub fn new(
        db: &DatabaseConnection,
        tmdb_service: &TmdbService,
        media_service: &MediaService,
    ) -> Self {
        Self {
            tmdb_service: Arc::new(tmdb_service.clone()),
            db: db.clone(),
            media_service: Arc::new(media_service.clone()),
        }
    }
}

impl ShowsService {}
