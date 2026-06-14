# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request


class FlipkartAIAssistantController(http.Controller):

    @http.route('/flipkart_os/ai/bootstrap', type='json', auth='user')
    def bootstrap(self, session_id=None):
        Session = request.env['flipkart.ai.chat.session']
        sessions = Session.search([('user_id', '=', request.env.user.id)], limit=20)
        if session_id:
            current = Session.browse(int(session_id)).exists()
        else:
            current = sessions[:1]
        if not current:
            current = Session.create({'name': 'New AI Chat'})
            sessions = current | sessions
        return {
            'sessions': [self._session(session) for session in sessions],
            'current_session': self._session(current),
            'messages': [current._serialize_message(message) for message in current.message_ids.sorted('id')],
            'actions': [action._serialize() for action in current.proposed_action_ids],
            'settings': self._settings_status(),
        }

    @http.route('/flipkart_os/ai/session/new', type='json', auth='user')
    def new_session(self):
        session = request.env['flipkart.ai.chat.session'].create({'name': 'New AI Chat'})
        return {'session': self._session(session), 'messages': [], 'actions': []}

    @http.route('/flipkart_os/ai/session/load', type='json', auth='user')
    def load_session(self, session_id):
        session = request.env['flipkart.ai.chat.session'].browse(int(session_id)).exists()
        if not session:
            return {'error': 'Session not found.'}
        if session.user_id != request.env.user:
            return {'error': 'You cannot open this chat session.'}
        return {
            'session': self._session(session),
            'messages': [session._serialize_message(message) for message in session.message_ids.sorted('id')],
            'actions': [action._serialize() for action in session.proposed_action_ids],
        }

    @http.route('/flipkart_os/ai/session/delete', type='json', auth='user')
    def delete_session(self, session_id):
        Session = request.env['flipkart.ai.chat.session']
        session = Session.browse(int(session_id)).exists()
        if not session:
            return {'error': 'Session not found.'}
        if session.user_id != request.env.user:
            return {'error': 'You cannot delete this chat session.'}
        session.unlink()
        sessions = Session.search([('user_id', '=', request.env.user.id)], limit=20)
        current = sessions[:1]
        if not current:
            current = Session.create({'name': 'New AI Chat'})
            sessions = current | sessions
        return {
            'sessions': [self._session(item) for item in sessions],
            'current_session': self._session(current),
            'messages': [current._serialize_message(message) for message in current.message_ids.sorted('id')],
            'actions': [action._serialize() for action in current.proposed_action_ids],
        }

    @http.route('/flipkart_os/ai/message/send', type='json', auth='user')
    def send_message(self, session_id, content):
        session = request.env['flipkart.ai.chat.session'].browse(int(session_id)).exists()
        if not session:
            return {'error': 'Session not found.'}
        if session.user_id != request.env.user:
            return {'error': 'You cannot use this chat session.'}
        try:
            assistant_message = session.send_user_message(content)
        except Exception as error:
            return {
                'error': str(error),
                'session': self._session(session),
                'messages': [session._serialize_message(message) for message in session.message_ids.sorted('id')],
                'actions': [action._serialize() for action in session.proposed_action_ids],
            }
        return {
            'session': self._session(session),
            'messages': [session._serialize_message(message) for message in session.message_ids.sorted('id')],
            'assistant_message': assistant_message,
            'actions': [action._serialize() for action in session.proposed_action_ids],
        }

    @http.route('/flipkart_os/ai/action/approve', type='json', auth='user')
    def approve_action(self, action_id):
        action = request.env['flipkart.ai.proposed.action'].browse(int(action_id)).exists()
        if not action:
            return {'error': 'Action not found.'}
        try:
            return {'action': action.action_approve()}
        except Exception as error:
            return {'error': str(error), 'action': action._serialize()}

    @http.route('/flipkart_os/ai/action/reject', type='json', auth='user')
    def reject_action(self, action_id):
        action = request.env['flipkart.ai.proposed.action'].browse(int(action_id)).exists()
        if not action:
            return {'error': 'Action not found.'}
        return {'action': action.action_reject()}

    def _session(self, session):
        return {
            'id': session.id,
            'name': session.name,
            'write_date': session.write_date.isoformat() if session.write_date else None,
        }

    def _settings_status(self):
        settings = request.env['flipkart.ai.chat.session']._settings()
        return {
            'enabled': settings['enabled'],
            'provider_name': settings['provider_name'],
            'api_url_configured': bool(settings['api_url']),
            'model': settings['model'],
            'api_key_configured': bool(settings['api_key']),
            'api_format': settings['api_format'],
        }
