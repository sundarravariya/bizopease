# -*- coding: utf-8 -*-

import re
from odoo import models
from odoo.http import request


class Http(models.AbstractModel):
    _inherit = 'ir.http'

    @classmethod
    def _dispatch(cls, endpoint):
        """
        B2B OS: Global website lockdown safely.
        """
        website = getattr(request, 'website', None)
        
        if website:
            full_path = request.httprequest.path
            
            # Remove language prefix if present (e.g., /en/web/login -> /web/login)
            clean_path = re.sub(r'^/[a-zA-Z]{2}(_[a-zA-Z]{2})?/', '/', full_path)
            
            # Allowed paths for public visitors
            allowed_patterns = [
                '/web/login',
                '/web/signup',
                '/b2b/registration-pending',
                '/web/reset_password',
                '/web/database',
                '/web/static',
                '/web/content',
                '/web/image',
                '/web/assets',
                '/website/translations', # Critical for JS translation logic
                '/website/lang',
                '/logo',
                '/favicon.ico',
            ]
            
            is_allowed = False
            for pattern in allowed_patterns:
                if clean_path.startswith(pattern) or full_path.startswith(pattern):
                    is_allowed = True
                    break
            
            if not is_allowed:
                # Redirect public users to login
                if request.env.user.id == website.user_id.id:
                    return request.redirect('/web/login')
                
                # For logged-in users, check if they are approved
                is_internal = request.env.user.has_group('base.group_user')
                
                if not is_internal and not request.env.user.partner_id.b2b_approved:
                    # Allow logout
                    if clean_path == '/web/session/logout':
                        return super()._dispatch(endpoint)
                        
                    # If they are not approved, redirect to "Pending" page
                    if clean_path != '/b2b/registration-pending' and clean_path != '/web/session/logout':
                         return request.redirect('/b2b/registration-pending')

        return super()._dispatch(endpoint)
