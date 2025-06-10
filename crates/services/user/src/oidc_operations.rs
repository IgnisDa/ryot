use std::sync::Arc;

use application_utils::create_oidc_client;
use async_graphql::{Error, Result};
use media_models::OidcTokenOutput;
use openidconnect::{
    AuthorizationCode, CsrfToken, Nonce, Scope, TokenResponse, core::CoreAuthenticationFlow,
};
use supporting_service::SupportingService;

use crate::empty_nonce_verifier;

pub async fn get_oidc_redirect_url(ss: &Arc<SupportingService>) -> Result<String> {
    let Some((_http, client)) = create_oidc_client(&ss.config).await else {
        return Err(Error::new("OIDC client not configured"));
    };
    let (authorize_url, _, _) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("email".to_string()))
        .url();
    Ok(authorize_url.to_string())
}

pub async fn get_oidc_token(ss: &Arc<SupportingService>, code: String) -> Result<OidcTokenOutput> {
    let Some((http, client)) = create_oidc_client(&ss.config).await else {
        return Err(Error::new("OIDC client not configured"));
    };
    let token = client
        .exchange_code(AuthorizationCode::new(code))?
        .request_async(&http)
        .await?;
    let id_token = token.id_token().unwrap();
    let claims = id_token.claims(&client.id_token_verifier(), empty_nonce_verifier)?;
    let subject = claims.subject().to_string();
    let email = claims
        .email()
        .map(|e| e.to_string())
        .ok_or_else(|| Error::new("Email not found in OIDC token claims"))?;
    Ok(OidcTokenOutput { subject, email })
}
