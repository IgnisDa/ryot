use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use database_models::{access_link, prelude::AccessLink};
use database_utils::revoke_access_link;
use sea_orm::{ColumnTrait, Condition, EntityTrait, QueryFilter, QuerySelect};
use sea_query::Expr;
use supporting_service::SupportingService;

pub async fn revoke_invalid_access_tokens(ss: &Arc<SupportingService>) -> Result<()> {
    let access_links = AccessLink::find()
        .select_only()
        .column(access_link::Column::Id)
        .filter(
            Condition::any()
                .add(
                    Expr::col(access_link::Column::TimesUsed)
                        .gte(Expr::col(access_link::Column::MaximumUses)),
                )
                .add(access_link::Column::ExpiresOn.lte(Utc::now())),
        )
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for access_link in access_links {
        revoke_access_link(&ss.db, access_link).await?;
    }
    Ok(())
}
