# -*- coding: utf-8 -*-
from odoo import models, fields, _


class ResPartner(models.Model):
    _inherit = 'res.partner'

    b2b_website_price_mode = fields.Selection(
        [
            ('show', 'Show Sale Price'),
            ('hide', 'Hide Sale Price'),
        ],
        string='Website Pricing',
        default='hide',
        required=True,
        help='Choose whether this customer sees website prices or only browses without pricing.',
    )
    b2b_website_discount_percent = fields.Float(
        string='Website Discount %',
        default=0.0,
        help='Discount percentage applied to website pricing for this customer when pricing is visible.',
    )

    b2b_approved = fields.Boolean(
        string='B2B Approved',
        default=False,
        help='Set to True when this customer is approved to place B2B orders.',
    )
    b2b_pending = fields.Boolean(
        string='Pending B2B Approval',
        default=False,
        help='Automatically set when a customer requests access via the website.',
    )
    b2b_business_name = fields.Char(
        string='B2B Business Name',
        help='As provided by the customer during registration.'
    )
    b2b_business_photo = fields.Binary(
        string='Business Card / Shop Photo',
        help='Uploaded via the signup form.'
    )

    def action_view_business_photo(self):
        self.ensure_one()
        if not self.b2b_business_photo:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _('No Photo'),
                    'message': _('This customer has not uploaded a business photo.'),
                    'type': 'warning',
                    'sticky': False,
                }
            }
        
        return {
            'type': 'ir.actions.act_url',
            'url': '/web/content?model=res.partner&id=%s&field=b2b_business_photo' % self.id,
            'target': 'new',
        }

    def action_view_ledger(self):
        self.ensure_one()
        action = self.env["ir.actions.actions"]._for_xml_id("b2b_os.action_b2b_partner_ledger_detailed")
        action['domain'] = [('partner_id', '=', self.id)]
        action['context'] = {'default_partner_id': self.id, 'search_default_partner_id': self.id}
        action['view_mode'] = 'list,pivot'
        return action

    def _b2b_get_website_pricing_policy(self):
        self.ensure_one()
        partner = self.commercial_partner_id
        discount = min(max(partner.b2b_website_discount_percent or 0.0, 0.0), 100.0)
        mode = partner.b2b_website_price_mode or 'hide'
        return {
            'mode': mode,
            'discount_percent': discount,
            'hide_prices': mode == 'hide',
        }
