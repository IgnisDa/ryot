use std::sync::Arc;

use anyhow::{Result, bail};
use database_models::{
    metadata, metadata_group, person,
    prelude::{Metadata, MetadataGroup, Person},
};
use dependent_models::ExpireCacheKeyInput;
use enum_models::EntityLot;
use media_models::MarkEntityAsPartialInput;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, prelude::Expr};
use supporting_service::SupportingService;
use uuid::Uuid;

pub async fn expire_cache_key(ss: &Arc<SupportingService>, cache_id: Uuid) -> Result<bool> {
    cache_service::expire_key(ss, ExpireCacheKeyInput::ById(cache_id)).await?;
    Ok(true)
}

pub async fn mark_entity_as_partial(
    ss: &Arc<SupportingService>,
    input: MarkEntityAsPartialInput,
) -> Result<bool> {
    match input.entity_lot {
        EntityLot::Metadata => {
            Metadata::update_many()
                .filter(metadata::Column::Id.eq(&input.entity_id))
                .col_expr(metadata::Column::IsPartial, Expr::value(true))
                .exec(&ss.db)
                .await?;
        }
        EntityLot::MetadataGroup => {
            MetadataGroup::update_many()
                .filter(metadata_group::Column::Id.eq(&input.entity_id))
                .col_expr(metadata_group::Column::IsPartial, Expr::value(true))
                .exec(&ss.db)
                .await?;
        }
        EntityLot::Person => {
            Person::update_many()
                .filter(person::Column::Id.eq(&input.entity_id))
                .col_expr(person::Column::IsPartial, Expr::value(true))
                .exec(&ss.db)
                .await?;
        }
        _ => bail!("Invalid entity lot".to_owned()),
    }
    Ok(true)
}
