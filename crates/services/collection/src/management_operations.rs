use std::sync::Arc;

use anyhow::{Result, bail};
use common_models::DefaultCollection;
use database_models::{collection, prelude::Collection};
use dependent_utils::expire_user_collections_list_cache;
use sea_orm::{ColumnTrait, EntityTrait, Iterable, QueryFilter};
use supporting_service::SupportingService;

pub async fn delete_collection(
    user_id: &String,
    name: &str,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    if DefaultCollection::iter().any(|col_name| col_name.to_string() == name) {
        bail!("Can not delete a default collection");
    }
    let collection = Collection::find()
        .filter(collection::Column::Name.eq(name))
        .filter(collection::Column::UserId.eq(user_id.to_owned()))
        .one(&ss.db)
        .await?;
    let Some(c) = collection else {
        return Ok(false);
    };
    let resp = Collection::delete_by_id(c.id).exec(&ss.db).await?;
    if resp.rows_affected > 0 {
        expire_user_collections_list_cache(user_id, ss).await?;
    }
    Ok(true)
}
