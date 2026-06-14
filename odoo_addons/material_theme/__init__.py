def post_init_hook(env):
    """Set the Material App Screen as the default home action for all internal users."""
    action = env.ref("material_theme.action_material_app_screen", raise_if_not_found=False)
    if not action:
        return
    # Apply to all internal (non-portal, non-public) users
    users = env["res.users"].sudo().search([("share", "=", False)])
    users.write({"action_id": action.id})
