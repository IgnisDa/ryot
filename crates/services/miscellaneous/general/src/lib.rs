use std::sync::Arc;

use anyhow::{Result, bail};
use common_models::EntityWithLot;
use database_models::{
    metadata, metadata_group, person,
    prelude::{Metadata, MetadataGroup, Person},
};
use dependent_models::ExpireCacheKeyInput;
use dependent_utility_utils::{
    expire_metadata_details_cache, expire_metadata_group_details_cache, expire_person_details_cache,
};
use enum_models::EntityLot;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, prelude::Expr};
use supporting_service::SupportingService;
use uuid::Uuid;

pub async fn expire_cache_key(ss: &Arc<SupportingService>, cache_id: Uuid) -> Result<bool> {
    cache_service::expire_key(ss, ExpireCacheKeyInput::ById(cache_id)).await?;
    Ok(true)
}

pub async fn mark_entity_as_partial(
    ss: &Arc<SupportingService>,
    input: EntityWithLot,
) -> Result<bool> {
    macro_rules! update_entity {
        ($entity:ident, $col_mod:ident, $expire_fn:ident) => {{
            $entity::update_many()
                .filter($col_mod::Column::Id.eq(&input.entity_id))
                .col_expr($col_mod::Column::IsPartial, Expr::value(true))
                .exec(&ss.db)
                .await?;
            $expire_fn(&input.entity_id, ss).await?;
        }};
    }

    match input.entity_lot {
        EntityLot::Person => update_entity!(Person, person, expire_person_details_cache),
        EntityLot::Metadata => update_entity!(Metadata, metadata, expire_metadata_details_cache),
        EntityLot::MetadataGroup => {
            update_entity!(
                MetadataGroup,
                metadata_group,
                expire_metadata_group_details_cache
            )
        }
        _ => bail!("Invalid entity lot".to_owned()),
    }
    tracing::debug!("Marked {:?} as partial", input);
    Ok(true)
}
