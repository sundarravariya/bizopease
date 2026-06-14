# -*- coding: utf-8 -*-
import json
import logging
import urllib.error
import urllib.request
from datetime import timedelta

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError

_logger = logging.getLogger(__name__)


class FlipkartAIChatSession(models.Model):
    _name = 'flipkart.ai.chat.session'
    _description = 'Business OS AI Chat Session'
    _order = 'write_date desc, id desc'

    name = fields.Char(string='Title', required=True, default='New AI Chat')
    user_id = fields.Many2one('res.users', string='User', required=True, default=lambda self: self.env.user)
    active = fields.Boolean(default=True)
    message_ids = fields.One2many('flipkart.ai.chat.message', 'session_id', string='Messages')
    proposed_action_ids = fields.One2many('flipkart.ai.proposed.action', 'session_id', string='Proposed Actions')

    def action_open(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.client',
            'tag': 'flipkart_ai_assistant',
            'params': {'session_id': self.id},
        }

    def _settings(self):
        param = self.env['ir.config_parameter'].sudo()
        enabled = param.get_param('flipkart_os.ai_enabled', 'False') == 'True'
        settings = {
            'enabled': enabled,
            'provider_name': param.get_param('flipkart_os.ai_provider_name') or 'OpenAI-compatible',
            'api_url': param.get_param('flipkart_os.ai_api_url') or '',
            'model': param.get_param('flipkart_os.ai_model') or '',
            'api_key': param.get_param('flipkart_os.ai_api_key') or '',
            'api_format': param.get_param('flipkart_os.ai_api_format') or 'openai_chat',
            'timeout': self._safe_int(param.get_param('flipkart_os.ai_timeout'), 60, 5, 300),
            'temperature': self._safe_float(param.get_param('flipkart_os.ai_temperature'), 0.2, 0.0, 2.0),
        }
        if settings['api_url'].rstrip('/') == 'https://opencode.ai/zen':
            settings['api_url'] = 'https://opencode.ai/zen/v1/chat/completions'
        return settings

    def _safe_int(self, value, default, minimum, maximum):
        try:
            number = int(value)
        except (TypeError, ValueError):
            return default
        return min(max(number, minimum), maximum)

    def _safe_float(self, value, default, minimum, maximum):
        try:
            number = float(value)
        except (TypeError, ValueError):
            return default
        return min(max(number, minimum), maximum)

    def send_user_message(self, content):
        self.ensure_one()
        content = (content or '').strip()
        if not content:
            raise UserError(_('Please enter a message.'))

        settings = self._settings()
        self._validate_settings(settings)
        self.env['flipkart.ai.chat.message'].create({
            'session_id': self.id,
            'role': 'user',
            'content': content,
        })
        if self.name == 'New AI Chat':
            self.name = content[:70]

        messages = self._provider_messages()
        response_message = self._run_ai_loop(settings, messages)
        assistant_message = self.env['flipkart.ai.chat.message'].create({
            'session_id': self.id,
            'role': 'assistant',
            'content': response_message.get('content') or '',
            'payload': json.dumps(response_message, default=str),
        })
        return self._serialize_message(assistant_message)

    def _validate_settings(self, settings):
        if not settings['enabled']:
            raise UserError(_('AI Assistant is disabled in Business OS Settings.'))
        if settings['api_format'] != 'openai_chat':
            raise UserError(_('Only OpenAI-compatible chat completions are supported in this version.'))
        if not settings['api_url'] or not settings['model'] or not settings['api_key']:
            raise UserError(_('Please configure AI URL, model, and API key in Business OS Settings.'))

    def _provider_messages(self):
        recent = self.message_ids.sorted('id')[-16:]
        messages = [{'role': 'system', 'content': self._system_prompt()}]
        messages.extend({'role': msg.role, 'content': msg.content or ''} for msg in recent if msg.role in ('user', 'assistant'))
        return messages

    def _system_prompt(self):
        return """You are the Business OS AI Assistant for an Odoo business database.
Talk like a practical human business advisor. Be concise, direct, and specific.
Use tools to inspect Odoo data before giving factual business answers.
Never invent numbers. If data is missing, say what is missing.
You can discover and read Odoo models through the provided read-only ORM tools.
You may propose draft purchase orders and follow-up activities only by calling the proposal tools.
Never confirm, post, validate, delete, mark paid, or perform irreversible actions.
For purchase/inventory suggestions, prefer cash-efficient pipeline thinking: keep around 30 days on-hand, account for incoming POs and transit timing, and avoid overstocking warehouse inventory."""

    def _tool_definitions(self):
        return [
            {
                'type': 'function',
                'function': {
                    'name': 'business_snapshot',
                    'description': 'Get compact Business OS summaries: supplier reorder, stock, sales, purchase orders, consignments, returns, ledgers.',
                    'parameters': {'type': 'object', 'properties': {}, 'additionalProperties': False},
                },
            },
            {
                'type': 'function',
                'function': {
                    'name': 'list_odoo_models',
                    'description': 'Find Odoo models by technical name or label so the assistant can choose the right model before reading data.',
                    'parameters': {
                        'type': 'object',
                        'properties': {
                            'query': {'type': 'string'},
                            'limit': {'type': 'integer'},
                        },
                        'additionalProperties': False,
                    },
                },
            },
            {
                'type': 'function',
                'function': {
                    'name': 'model_search_read',
                    'description': 'Read records from any Odoo model using a JSON domain and field list. Limit is capped server-side.',
                    'parameters': {
                        'type': 'object',
                        'properties': {
                            'model': {'type': 'string'},
                            'domain': {'type': 'array'},
                            'fields': {'type': 'array', 'items': {'type': 'string'}},
                            'limit': {'type': 'integer'},
                            'order': {'type': 'string'},
                        },
                        'required': ['model'],
                        'additionalProperties': False,
                    },
                },
            },
            {
                'type': 'function',
                'function': {
                    'name': 'model_count',
                    'description': 'Count records in any Odoo model using a JSON domain.',
                    'parameters': {
                        'type': 'object',
                        'properties': {'model': {'type': 'string'}, 'domain': {'type': 'array'}},
                        'required': ['model'],
                        'additionalProperties': False,
                    },
                },
            },
            {
                'type': 'function',
                'function': {
                    'name': 'grouped_summary',
                    'description': 'Grouped numeric summary using Odoo read_group.',
                    'parameters': {
                        'type': 'object',
                        'properties': {
                            'model': {'type': 'string'},
                            'domain': {'type': 'array'},
                            'fields': {'type': 'array', 'items': {'type': 'string'}},
                            'groupby': {'type': 'array', 'items': {'type': 'string'}},
                            'limit': {'type': 'integer'},
                        },
                        'required': ['model', 'fields', 'groupby'],
                        'additionalProperties': False,
                    },
                },
            },
            {
                'type': 'function',
                'function': {
                    'name': 'propose_draft_purchase_order',
                    'description': 'Propose a draft purchase order. This only creates an approval card, not the PO.',
                    'parameters': {
                        'type': 'object',
                        'properties': {
                            'vendor_id': {'type': 'integer'},
                            'vendor_name': {'type': 'string'},
                            'notes': {'type': 'string'},
                            'lines': {
                                'type': 'array',
                                'items': {
                                    'type': 'object',
                                    'properties': {
                                        'product_id': {'type': 'integer'},
                                        'sku': {'type': 'string'},
                                        'product_name': {'type': 'string'},
                                        'quantity': {'type': 'number'},
                                        'price_unit': {'type': 'number'},
                                    },
                                    'required': ['quantity'],
                                },
                            },
                        },
                        'required': ['lines'],
                        'additionalProperties': False,
                    },
                },
            },
            {
                'type': 'function',
                'function': {
                    'name': 'propose_activity',
                    'description': 'Propose a follow-up activity. This only creates an approval card.',
                    'parameters': {
                        'type': 'object',
                        'properties': {
                            'res_model': {'type': 'string'},
                            'res_id': {'type': 'integer'},
                            'summary': {'type': 'string'},
                            'note': {'type': 'string'},
                            'date_deadline': {'type': 'string'},
                            'user_id': {'type': 'integer'},
                        },
                        'required': ['res_model', 'res_id', 'summary'],
                        'additionalProperties': False,
                    },
                },
            },
        ]

    def _run_ai_loop(self, settings, messages):
        for _idx in range(4):
            response = self._call_provider(settings, messages)
            message = response.get('choices', [{}])[0].get('message') or {}
            tool_calls = message.get('tool_calls') or []
            if not tool_calls:
                return message
            messages.append(message)
            for call in tool_calls:
                result = self._execute_tool_call(call)
                messages.append({
                    'role': 'tool',
                    'tool_call_id': call.get('id'),
                    'name': call.get('function', {}).get('name'),
                    'content': json.dumps(result, default=str),
                })
        return {'role': 'assistant', 'content': _('I checked several tools, but the request needs to be narrowed before I can answer safely.')}

    def _call_provider(self, settings, messages):
        body = {
            'model': settings['model'],
            'messages': messages,
            'temperature': settings['temperature'],
            'tools': self._tool_definitions(),
            'tool_choice': 'auto',
        }
        request = urllib.request.Request(
            settings['api_url'],
            data=json.dumps(body).encode('utf-8'),
            headers={
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': 'Bearer %s' % settings['api_key'],
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                              '(KHTML, like Gecko) Chrome/124.0 Safari/537.36 BusinessOS/1.0',
            },
            method='POST',
        )
        try:
            with urllib.request.urlopen(request, timeout=settings['timeout']) as response:
                payload = response.read().decode('utf-8')
        except urllib.error.HTTPError as error:
            detail = error.read().decode('utf-8', errors='replace')[:1000]
            raise UserError(_('AI provider error %s: %s') % (error.code, detail))
        except Exception as error:
            _logger.exception('AI provider call failed')
            raise UserError(_('AI provider call failed: %s') % error)
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            raise UserError(_('AI provider returned invalid JSON.'))

    def _execute_tool_call(self, call):
        function = call.get('function') or {}
        name = function.get('name')
        raw_args = function.get('arguments') or '{}'
        try:
            args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
        except json.JSONDecodeError:
            return {'error': 'Invalid tool JSON arguments.'}
        try:
            if name == 'business_snapshot':
                return self._tool_business_snapshot()
            if name == 'list_odoo_models':
                return self._tool_list_odoo_models(args)
            if name == 'model_search_read':
                return self._tool_model_search_read(args)
            if name == 'model_count':
                return self._tool_model_count(args)
            if name == 'grouped_summary':
                return self._tool_grouped_summary(args)
            if name == 'propose_draft_purchase_order':
                return self._tool_propose_action('purchase_order', args)
            if name == 'propose_activity':
                return self._tool_propose_action('activity', args)
            return {'error': 'Unknown tool: %s' % name}
        except Exception as error:
            _logger.exception('AI tool failed: %s', name)
            return {'error': str(error)}

    def _safe_model(self, model_name):
        if not model_name or model_name not in self.env:
            raise UserError(_('Model not found: %s') % model_name)
        return self.env[model_name].sudo()

    def _safe_domain(self, domain):
        return domain if isinstance(domain, list) else []

    def _safe_fields(self, model, fields_list, limit_default=8):
        if not fields_list:
            candidates = ['name', 'display_name', 'default_code', 'state', 'date_order', 'create_date', 'amount_total', 'qty_available', 'free_qty']
            return [name for name in candidates if name in model._fields][:limit_default] or ['display_name']
        safe = [field for field in fields_list if isinstance(field, str) and field in model._fields][:25]
        return safe or ['display_name']

    def _tool_model_search_read(self, args):
        model = self._safe_model(args.get('model'))
        fields_list = self._safe_fields(model, args.get('fields') or [])
        limit = min(max(int(args.get('limit') or 10), 1), 50)
        records = model.search_read(self._safe_domain(args.get('domain')), fields_list, limit=limit, order=args.get('order') or None)
        return {'model': model._name, 'fields': fields_list, 'count': len(records), 'records': records}

    def _tool_list_odoo_models(self, args):
        query = (args.get('query') or '').strip()
        limit = min(max(int(args.get('limit') or 40), 1), 120)
        domain = []
        if query:
            domain = ['|', ('model', 'ilike', query), ('name', 'ilike', query)]
        records = self.env['ir.model'].sudo().search_read(domain, ['model', 'name', 'state'], limit=limit, order='model asc')
        return {'query': query, 'count': len(records), 'models': records}

    def _tool_model_count(self, args):
        model = self._safe_model(args.get('model'))
        return {'model': model._name, 'count': model.search_count(self._safe_domain(args.get('domain')))}

    def _tool_grouped_summary(self, args):
        model = self._safe_model(args.get('model'))
        fields_list = self._safe_fields(model, args.get('fields') or [])
        groupby = [field for field in (args.get('groupby') or []) if field in model._fields][:4]
        if not groupby:
            raise UserError(_('Please provide valid groupby fields.'))
        limit = min(max(int(args.get('limit') or 20), 1), 80)
        rows = model.read_group(self._safe_domain(args.get('domain')), fields_list, groupby, limit=limit, lazy=False)
        return {'model': model._name, 'groupby': groupby, 'rows': rows}

    def _tool_business_snapshot(self):
        snapshot = {}
        snapshot['supplier_reorder'] = self._snapshot_model(
            'flipkart.supplier.reorder',
            [('action_required', '=', True)],
            ['sku', 'product_id', 'physical_stock', 'incoming_qty', 'daily_avg_sales', 'days_in_hand', 'next_po_arrival_date', 'pipeline_lowest_days', 'order_now_qty', 'next_order_date', 'urgency'],
            'urgency_sequence asc, order_now_qty desc',
            15,
        )
        snapshot['fbf_replenishment'] = self._snapshot_model(
            'flipkart.fbf.replenishment',
            [('qty_to_send', '>', 0)],
            ['account_id', 'warehouse_name', 'sku', 'fsn', 'fbf_stock', 'in_transit', 'daily_sales', 'qty_to_send', 'urgency'],
            'urgency_sequence asc, qty_to_send desc',
            15,
        )
        snapshot['open_purchase_orders'] = self._snapshot_model(
            'purchase.order',
            [('state', 'in', ['draft', 'sent', 'purchase'])],
            ['name', 'partner_id', 'date_order', 'state', 'amount_total'],
            'date_order desc',
            15,
        )
        snapshot['recent_sales'] = self._snapshot_group(
            'flipkart.sales.dashboard',
            [('order_date', '>=', fields.Date.context_today(self) - timedelta(days=30))],
            ['final_sale_units:sum'],
            ['account_id'],
        )
        snapshot['consignments'] = self._snapshot_group('flipkart.consignment', [], ['id:count'], ['state', 'account'])
        snapshot['returns'] = self._snapshot_group('flipkart.return.management', [], ['id:count'], ['state'])
        snapshot['ledger_summary'] = self._snapshot_model(
            'flipkart.unified.ledger.summary',
            [],
            ['party_id', 'party_type', 'balance'],
            'balance desc',
            15,
        )
        return snapshot

    def _snapshot_model(self, model_name, domain, fields_list, order=None, limit=10):
        if model_name not in self.env:
            return {'error': 'model missing'}
        try:
            model = self.env[model_name].sudo()
            return model.search_read(domain, [f for f in fields_list if f in model._fields], limit=limit, order=order)
        except Exception as error:
            return {'error': str(error)}

    def _snapshot_group(self, model_name, domain, fields_list, groupby):
        if model_name not in self.env:
            return {'error': 'model missing'}
        try:
            model = self.env[model_name].sudo()
            return model.read_group(domain, fields_list, groupby, lazy=False)
        except Exception as error:
            return {'error': str(error)}

    def _tool_propose_action(self, action_type, args):
        title = _('Draft Purchase Order') if action_type == 'purchase_order' else _('Follow-up Activity')
        action = self.env['flipkart.ai.proposed.action'].create({
            'session_id': self.id,
            'action_type': action_type,
            'title': title,
            'summary': args.get('notes') or args.get('summary') or title,
            'payload': json.dumps(args, default=str),
        })
        return {'proposal_id': action.id, 'state': action.state, 'title': action.title}

    def _serialize_message(self, message):
        return {
            'id': message.id,
            'role': message.role,
            'content': message.content,
            'create_date': fields.Datetime.to_string(message.create_date) if message.create_date else None,
        }


class FlipkartAIChatMessage(models.Model):
    _name = 'flipkart.ai.chat.message'
    _description = 'Business OS AI Chat Message'
    _order = 'id asc'

    session_id = fields.Many2one('flipkart.ai.chat.session', required=True, ondelete='cascade')
    user_id = fields.Many2one('res.users', string='User', default=lambda self: self.env.user)
    role = fields.Selection([
        ('user', 'User'),
        ('assistant', 'Assistant'),
        ('system', 'System'),
        ('tool', 'Tool'),
    ], required=True)
    content = fields.Text()
    payload = fields.Text()


class FlipkartAIProposedAction(models.Model):
    _name = 'flipkart.ai.proposed.action'
    _description = 'Business OS AI Proposed Action'
    _order = 'id desc'

    session_id = fields.Many2one('flipkart.ai.chat.session', required=True, ondelete='cascade')
    action_type = fields.Selection([
        ('purchase_order', 'Draft Purchase Order'),
        ('activity', 'Follow-up Activity'),
    ], required=True)
    title = fields.Char(required=True)
    summary = fields.Text()
    payload = fields.Text(required=True)
    state = fields.Selection([
        ('proposed', 'Proposed'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('failed', 'Failed'),
    ], default='proposed', required=True)
    result_model = fields.Char(readonly=True)
    result_res_id = fields.Integer(readonly=True)
    error_message = fields.Text(readonly=True)

    def action_approve(self):
        self.ensure_one()
        if self.state != 'proposed':
            raise UserError(_('Only proposed actions can be approved.'))
        payload = json.loads(self.payload or '{}')
        try:
            if self.action_type == 'purchase_order':
                record = self._create_draft_purchase_order(payload)
            elif self.action_type == 'activity':
                record = self._create_activity(payload)
            else:
                raise UserError(_('Unsupported action type.'))
            self.write({
                'state': 'approved',
                'result_model': record._name,
                'result_res_id': record.id,
                'error_message': False,
            })
            return self._serialize()
        except Exception as error:
            self.write({'state': 'failed', 'error_message': str(error)})
            raise

    def action_reject(self):
        self.ensure_one()
        if self.state == 'proposed':
            self.state = 'rejected'
        return self._serialize()

    def _create_draft_purchase_order(self, payload):
        partner = self._resolve_vendor(payload)
        lines = payload.get('lines') or []
        if not lines:
            raise UserError(_('No purchase order lines were proposed.'))

        order_lines = []
        for line in lines:
            product = self._resolve_product(line)
            qty = float(line.get('quantity') or 0)
            if qty <= 0:
                continue
            price_unit = line.get('price_unit')
            if price_unit is None:
                seller = product.seller_ids.filtered(lambda s: s.partner_id == partner)[:1]
                price_unit = seller.price if seller else product.standard_price
            order_lines.append((0, 0, {
                'product_id': product.id,
                'name': product.display_name,
                'product_qty': qty,
                'price_unit': float(price_unit or 0),
                'product_uom': product.uom_po_id.id or product.uom_id.id,
                'date_planned': fields.Datetime.now(),
            }))
        if not order_lines:
            raise UserError(_('No valid purchase order lines were proposed.'))
        return self.env['purchase.order'].create({
            'partner_id': partner.id,
            'origin': 'Business OS AI Assistant',
            'notes': payload.get('notes') or False,
            'order_line': order_lines,
        })

    def _resolve_vendor(self, payload):
        Partner = self.env['res.partner']
        vendor_id = payload.get('vendor_id')
        if vendor_id:
            partner = Partner.browse(int(vendor_id)).exists()
            if partner:
                return partner
        vendor_name = (payload.get('vendor_name') or '').strip()
        if vendor_name:
            partner = Partner.search([('name', 'ilike', vendor_name)], limit=1)
            if partner:
                return partner
        raise UserError(_('Please include a valid vendor for the draft purchase order.'))

    def _resolve_product(self, line):
        Product = self.env['product.product']
        product_id = line.get('product_id')
        if product_id:
            product = Product.browse(int(product_id)).exists()
            if product:
                return product
        sku = (line.get('sku') or '').strip()
        if sku:
            product = Product.search([('default_code', '=', sku)], limit=1)
            if product:
                return product
        name = (line.get('product_name') or '').strip()
        if name:
            product = Product.search([('name', 'ilike', name)], limit=1)
            if product:
                return product
        raise UserError(_('Could not resolve product for proposed PO line.'))

    def _create_activity(self, payload):
        model_name = payload.get('res_model')
        res_id = int(payload.get('res_id') or 0)
        if not model_name or model_name not in self.env or not res_id:
            raise UserError(_('Please include a valid target record for the activity.'))
        record = self.env[model_name].browse(res_id).exists()
        if not record:
            raise UserError(_('The activity target record does not exist.'))
        model_id = self.env['ir.model']._get_id(model_name)
        activity_type = self.env.ref('mail.mail_activity_data_todo', raise_if_not_found=False)
        deadline = payload.get('date_deadline') or fields.Date.context_today(self)
        return self.env['mail.activity'].create({
            'res_model_id': model_id,
            'res_id': record.id,
            'activity_type_id': activity_type.id if activity_type else False,
            'summary': payload.get('summary') or _('AI Follow-up'),
            'note': payload.get('note') or '',
            'date_deadline': deadline,
            'user_id': int(payload.get('user_id') or self.env.user.id),
        })

    def _serialize(self):
        return {
            'id': self.id,
            'session_id': self.session_id.id,
            'action_type': self.action_type,
            'title': self.title,
            'summary': self.summary,
            'payload': json.loads(self.payload or '{}'),
            'state': self.state,
            'result_model': self.result_model,
            'result_res_id': self.result_res_id,
            'error_message': self.error_message,
        }
