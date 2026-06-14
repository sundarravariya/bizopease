// Central brand config for the SaaS product. The product name is BizOpease;
// the per-tenant company name comes from the logged-in Odoo session
// (user.company_name) so each workspace shows its own business name.

export const BRAND = 'BizOpease';
export const BRAND_TAGLINE = 'Admin Portal';
export const BRAND_VERSION = 'v2.0';

/** Display company name for a tenant, falling back to the product brand. */
export function companyName(name?: string | null): string {
  return (name && name.trim()) ? name.trim() : BRAND;
}

/** Single uppercase initial for the logo badge. */
export function brandInitial(name?: string | null): string {
  const n = companyName(name);
  return n.charAt(0).toUpperCase();
}
