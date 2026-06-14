# -*- coding: utf-8 -*-
from odoo import models, fields, api


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    flipkart_stock_deduction_enabled = fields.Boolean(
        string='Enable Stock Deduction (Daily Orders)',
        config_parameter='flipkart_os.stock_deduction_enabled',
        default=False,
        help='When enabled, Daily Orders create and validate stock pickings.',
    )
    flipkart_returns_stock_move_enabled = fields.Boolean(
        string='Enable Stock Move (Returns)',
        config_parameter='flipkart_os.returns_stock_move_enabled',
        default=False,
        help='When enabled, confirming a return inward creates and validates a stock receipt.',
    )
    flipkart_consignment_stock_move_enabled = fields.Boolean(
        string='Enable Consignment Stock Move',
        config_parameter='flipkart_os.consignment_stock_move_enabled',
        default=True,
        help='When enabled, marking a consignment as Picked Up creates and validates a stock delivery.',
    )
    flipkart_dead_stock_sales_days = fields.Integer(
        string='Dead Stock Sales Days',
        config_parameter='flipkart_os.dead_stock_sales_days',
        default=30,
    )
    flipkart_fbf_target_cover_days = fields.Integer(
        string='FBF Target Cover Days',
        config_parameter='flipkart_os.fbf_target_cover_days',
        default=14,
    )
    flipkart_fbf_critical_days = fields.Integer(
        string='FBF Critical Below Days',
        config_parameter='flipkart_os.fbf_critical_days',
        default=7,
    )
    flipkart_fbf_moderate_days = fields.Integer(
        string='FBF Moderate Below Days',
        config_parameter='flipkart_os.fbf_moderate_days',
        default=21,
    )
    flipkart_supplier_sales_days = fields.Integer(
        string='Supplier Sales Days',
        config_parameter='flipkart_os.supplier_sales_days',
        default=30,
    )
    flipkart_supplier_lead_time_days = fields.Integer(
        string='Supplier Lead Time Days',
        config_parameter='flipkart_os.supplier_lead_time_days',
        default=65,
    )
    flipkart_supplier_target_cover_days = fields.Integer(
        string='Supplier Minimum On-Hand Days',
        config_parameter='flipkart_os.supplier_target_cover_days',
        default=30,
    )
    flipkart_supplier_order_cycle_days = fields.Integer(
        string='Supplier Order Cycle Days',
        config_parameter='flipkart_os.supplier_order_cycle_days',
        default=30,
    )
    flipkart_ai_enabled = fields.Boolean(
        string='Enable AI Assistant',
        config_parameter='flipkart_os.ai_enabled',
        default=False,
    )
    flipkart_ai_provider_name = fields.Char(
        string='AI Provider Name',
        config_parameter='flipkart_os.ai_provider_name',
        default='OpenAI-compatible',
    )
    flipkart_ai_api_url = fields.Char(
        string='AI Chat Completion URL',
        config_parameter='flipkart_os.ai_api_url',
        default='https://opencode.ai/zen/v1/chat/completions',
    )
    flipkart_ai_model = fields.Char(
        string='AI Model',
        config_parameter='flipkart_os.ai_model',
        default='minimax-m2.5-free',
    )
    flipkart_ai_api_key = fields.Char(
        string='AI API Key',
        config_parameter='flipkart_os.ai_api_key',
    )
    flipkart_ai_api_format = fields.Selection(
        [('openai_chat', 'OpenAI-compatible chat completions')],
        string='AI API Format',
        config_parameter='flipkart_os.ai_api_format',
        default='openai_chat',
    )
    flipkart_ai_timeout = fields.Integer(
        string='AI Timeout Seconds',
        config_parameter='flipkart_os.ai_timeout',
        default=60,
    )
    flipkart_ai_temperature = fields.Float(
        string='AI Temperature',
        config_parameter='flipkart_os.ai_temperature',
        default=0.2,
    )

    @api.model
    def get_values(self):
        res = super().get_values()
        param = self.env['ir.config_parameter'].sudo()
        bool_params = {
            'flipkart_stock_deduction_enabled': ('flipkart_os.stock_deduction_enabled', False),
            'flipkart_returns_stock_move_enabled': ('flipkart_os.returns_stock_move_enabled', False),
            'flipkart_consignment_stock_move_enabled': ('flipkart_os.consignment_stock_move_enabled', True),
            'flipkart_ai_enabled': ('flipkart_os.ai_enabled', False),
        }
        for field_name, (param_key, default_val) in bool_params.items():
            val = param.get_param(param_key)
            res[field_name] = default_val if val is False else (val == 'True')
        return res

    def set_values(self):
        super().set_values()
        param = self.env['ir.config_parameter'].sudo()
        bool_params = {
            'flipkart_stock_deduction_enabled': 'flipkart_os.stock_deduction_enabled',
            'flipkart_returns_stock_move_enabled': 'flipkart_os.returns_stock_move_enabled',
            'flipkart_consignment_stock_move_enabled': 'flipkart_os.consignment_stock_move_enabled',
            'flipkart_ai_enabled': 'flipkart_os.ai_enabled',
        }
        for field_name, param_key in bool_params.items():
            param.set_param(param_key, 'True' if self[field_name] else 'False')
        self._sync_ai_assistant_menu_access()

    def _sync_ai_assistant_menu_access(self):
        enabled = bool(self.flipkart_ai_enabled)
        group = self.env.ref('flipkart_os.group_flipkart_ai_assistant_user', raise_if_not_found=False)
        menu = self.env.ref('flipkart_os.menu_business_ai_assistant', raise_if_not_found=False)
        if group:
            if enabled:
                users = self.env['res.users'].sudo().search([
                    ('active', '=', True),
                    ('share', '=', False),
                    ('groups_id', 'in', [self.env.ref('base.group_user').id]),
                ])
                group.sudo().write({'users': [(6, 0, users.ids)]})
            else:
                group.sudo().write({'users': [(5, 0, 0)]})
        if menu:
            menu.sudo().write({'active': enabled})
        self.env['ir.ui.menu'].clear_caches()


class FlipkartAccount(models.Model):
    _name = 'flipkart.account'
    _description = 'Flipkart Seller Account'
    _order = 'name asc'

    name = fields.Char(string='Account Name', required=True)
    is_active = fields.Boolean(string='Active', default=True)

    _sql_constraints = [
        ('name_unique', 'UNIQUE(name)', 'Account name must be unique!'),
    ]

class FlipkartWarehouseConfig(models.Model):
    _name = 'flipkart.warehouse.config'
    _description = 'Flipkart FBF Warehouse Configuration'
    _order = 'transit_days asc'

    name = fields.Char(string='Warehouse Name', required=True)
    account_id = fields.Many2one('flipkart.account', string='Account', required=True)
    backend_warehouse_id = fields.Many2one(
        'stock.warehouse', string='Odoo Warehouse',
        help='Linked local warehouse in Odoo')
    flipkart_warehouse_code = fields.Char(
        string='Flipkart Warehouse Code', required=True,
        help='Warehouse Id from the Flipkart FBF CSV file')
    transit_days = fields.Integer(
        string='Transit Days from MAIN', default=3,
        help='Number of days to transit from MAIN to this FBF warehouse')
    is_active = fields.Boolean(string='Active', default=True)

    _sql_constraints = [
        ('code_account_unique', 'UNIQUE(flipkart_warehouse_code, account_id)',
         'Flipkart Warehouse Code must be unique per account!'),
    ]
