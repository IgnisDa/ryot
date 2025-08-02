use proc_macro::TokenStream;
use quote::quote;
use syn::{Attribute, Data, DeriveInput, Fields, Meta, parse_macro_input};

/// Derive macro for implementing MaskedConfig trait
#[proc_macro_derive(MaskedConfig, attributes(mask, mask_nested, mask_vec, skip_mask))]
pub fn derive_masked_config(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);

    let name = &input.ident;
    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();

    let field_assignments = match &input.data {
        Data::Struct(data_struct) => {
            match &data_struct.fields {
                Fields::Named(fields) => {
                    let assignments: Vec<_> = fields
                        .named
                        .iter()
                        .map(|field| {
                            let field_name = &field.ident;
                            let field_attrs = &field.attrs;

                            if has_attribute(field_attrs, "mask") {
                                quote! {
                                    #field_name: crate::mask_string(&self.#field_name)
                                }
                            } else if has_attribute(field_attrs, "mask_vec") {
                                quote! {
                                    #field_name: if self.#field_name.is_empty() {
                                        vec!["<empty>".to_owned()]
                                    } else {
                                        vec!["****".to_owned()]
                                    }
                                }
                            } else if has_attribute(field_attrs, "mask_nested") {
                                quote! {
                                    #field_name: self.#field_name.masked()
                                }
                            } else if has_attribute(field_attrs, "skip_mask") {
                                quote! {
                                    #field_name: self.#field_name.clone()
                                }
                            } else {
                                // Default behavior: clone for primitive types, call masked() for types that implement MaskedConfig
                                quote! {
                                    #field_name: self.#field_name.clone()
                                }
                            }
                        })
                        .collect();

                    quote! {
                        Self {
                            #(#assignments,)*
                        }
                    }
                }
                _ => {
                    return syn::Error::new_spanned(
                        &input,
                        "MaskedConfig can only be derived for structs with named fields",
                    )
                    .to_compile_error()
                    .into();
                }
            }
        }
        _ => {
            return syn::Error::new_spanned(&input, "MaskedConfig can only be derived for structs")
                .to_compile_error()
                .into();
        }
    };

    let expanded = quote! {
        impl #impl_generics crate::MaskedConfig for #name #ty_generics #where_clause {
            fn masked(&self) -> Self {
                #field_assignments
            }
        }
    };

    TokenStream::from(expanded)
}

fn has_attribute(attrs: &[Attribute], name: &str) -> bool {
    attrs.iter().any(|attr| {
        if let Meta::Path(path) = &attr.meta {
            path.is_ident(name)
        } else {
            false
        }
    })
}
