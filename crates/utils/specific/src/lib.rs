use anyhow::Result;
use common_utils::sleep_for_n_seconds;
use database_models::{metadata, prelude::Metadata};
use dependent_utils::deploy_update_metadata_job;
use enum_models::{MediaLot, MediaSource};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use std::sync::Arc;
use supporting_service::SupportingService;

pub mod audiobookshelf {
    use super::*;

    pub async fn get_updated_metadata(
        identifier: &String,
        ss: &Arc<SupportingService>,
    ) -> Result<metadata::Model> {
        async fn get_metadata(
            identifier: &String,
            ss: &Arc<SupportingService>,
        ) -> Result<metadata::Model> {
            let m = Metadata::find()
                .filter(metadata::Column::Identifier.eq(identifier))
                .filter(metadata::Column::Lot.eq(MediaLot::Podcast))
                .filter(metadata::Column::Source.eq(MediaSource::Itunes))
                .one(&ss.db)
                .await?
                .unwrap();
            Ok(m)
        }

        let already = get_metadata(identifier, ss).await?;
        if already.podcast_specifics.is_none() {
            deploy_update_metadata_job(&already.id, ss).await.unwrap();
            sleep_for_n_seconds(3).await;
        }
        get_metadata(identifier, ss).await
    }
}
