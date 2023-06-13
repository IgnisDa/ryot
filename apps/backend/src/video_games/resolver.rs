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

use super::igdb::IgdbService;

#[derive(Debug, Clone)]
pub struct VideoGamesService {
    db: DatabaseConnection,
    igdb_service: Arc<IgdbService>,
    media_service: Arc<MediaService>,
}

impl VideoGamesService {
    pub fn new(
        db: &DatabaseConnection,
        igdb_service: &IgdbService,
        media_service: &MediaService,
    ) -> Self {
        Self {
            igdb_service: Arc::new(igdb_service.clone()),
            db: db.clone(),
            media_service: Arc::new(media_service.clone()),
        }
    }
}

impl VideoGamesService {}
