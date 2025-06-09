use async_graphql::{Error, Result};
use common_models::DefaultCollection;
use database_models::{collection, prelude::Collection};
use dependent_utils::expire_user_collections_list_cache;
use sea_orm::{ColumnTrait, EntityTrait, Iterable, QueryFilter};

use crate::CollectionService;

pub async fn delete_collection(
    service: &CollectionService,
    user_id: String,
    name: &str,
) -> Result<bool> {
    if DefaultCollection::iter().any(|col_name| col_name.to_string() == name) {
        return Err(Error::new("Can not delete a default collection".to_owned()));
    }
    let collection = Collection::find()
        .filter(collection::Column::Name.eq(name))
        .filter(collection::Column::UserId.eq(user_id.to_owned()))
        .one(&service.0.db)
        .await?;
    let Some(c) = collection else {
        return Ok(false);
    };
    let resp = Collection::delete_by_id(c.id).exec(&service.0.db).await?;
    if resp.rows_affected > 0 {
        expire_user_collections_list_cache(&user_id, &service.0).await?;
    }
    Ok(true)
}
