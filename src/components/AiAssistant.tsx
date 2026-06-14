import { useState, useRef, useEffect } from 'react';
import { searchRead, odooCall, createRecord } from '../services/odoo';
import { useTheme } from '../context/ThemeContext';
import {
  X, Send, Bot, User, RefreshCw, Sparkles, Minimize2,
  CheckCircle2, XCircle, AlertCircle, FileText, CalendarClock,
} from 'lucide-react';

interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

interface ProposedAction {
  id: number;
  action_type: 'purchase_order' | 'activity';
  title: string;
  summary: string | false;
  state: 'proposed' | 'approved' | 'rejected' | 'failed';
  error_message: string | false;
  result_model: string | false;
  result_res_id: number | false;
}

const QUICK_ACTIONS = [
  'Show low stock products',
  'Pending FBF orders today',
  'Outstanding vendor balances',
  'Sales summary this month',
];

// Optimistic id for the just-typed user message before the server echoes it back.
let _tempId = -1;

export default function AiAssistant() {
  const { isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [actions, setActions] = useState<ProposedAction[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, actions, loading]);

  // Create the chat session lazily on first open.
  useEffect(() => {
    if (open && sessionId === null) {
      ensureSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ensureSession = async (): Promise<number | null> => {
    if (sessionId !== null) return sessionId;
    try {
      const id = await createRecord('flipkart.ai.chat.session', { name: 'New AI Chat' });
      setSessionId(id);
      return id;
    } catch (e: any) {
      setError(e?.message || 'Failed to start AI session');
      return null;
    }
  };

  const loadMessages = async (sid: number) => {
    const res = await searchRead<Message>('flipkart.ai.chat.message', {
      domain: [['session_id', '=', sid]],
      fields: ['id', 'role', 'content'],
      order: 'id asc',
      limit: 0,
    });
    if (Array.isArray(res)) {
      // Only user/assistant turns are meaningful to show; tool/system are internal.
      setMessages(res.filter(m => m.role === 'user' || m.role === 'assistant'));
    }
  };

  const loadActions = async (sid: number) => {
    const res = await searchRead<ProposedAction>('flipkart.ai.proposed.action', {
      domain: [['session_id', '=', sid]],
      fields: ['id', 'action_type', 'title', 'summary', 'state', 'error_message', 'result_model', 'result_res_id'],
      order: 'id desc',
      limit: 0,
    });
    if (Array.isArray(res)) setActions(res);
  };

  const sendMessage = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    setError(null);
    const sid = await ensureSession();
    if (sid === null) return;

    // Optimistic user bubble; reconciled with server state after the round-trip.
    setMessages(prev => [...prev, { id: _tempId--, role: 'user', content: msg }]);
    setInput('');
    setLoading(true);

    try {
      await odooCall('flipkart.ai.chat.session', 'send_user_message', [[sid], msg]);
      await loadMessages(sid);
      await loadActions(sid);
    } catch (e: any) {
      setError(e?.message || 'The AI assistant could not respond.');
      // Drop the optimistic bubble so the input can be retried cleanly.
      setMessages(prev => prev.filter(m => m.id > 0 || m.content !== msg));
    } finally {
      setLoading(false);
    }
  };

  const runActionDecision = async (actionId: number, method: 'action_approve' | 'action_reject') => {
    if (!sessionId) return;
    setBusyAction(actionId);
    setError(null);
    try {
      await odooCall('flipkart.ai.proposed.action', method, [[actionId]]);
      await loadActions(sessionId);
    } catch (e: any) {
      setError(e?.message || 'Action failed');
      await loadActions(sessionId);
    } finally {
      setBusyAction(null);
    }
  };

  const resetSession = async () => {
    setMessages([]);
    setActions([]);
    setError(null);
    setSessionId(null);
    await ensureSession();
  };

  const panelBg = isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200';
  const pendingActions = actions.filter(a => a.state === 'proposed');
  const resolvedActions = actions.filter(a => a.state !== 'proposed');

  const actionIcon = (t: string) => t === 'purchase_order'
    ? <FileText size={13} className="text-[#7367f0]" />
    : <CalendarClock size={13} className="text-[#7367f0]" />;

  return (
    <>
      {/* FAB Button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl shadow-[#7367f0]/40 transition-all hover:scale-110 active:scale-95"
          style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}
        >
          <Sparkles size={22} className="text-white" />
          <span className="absolute top-0 right-0 w-4 h-4 bg-green-400 rounded-full border-2 border-white animate-pulse" />
        </button>
      )}

      {/* Chat Panel */}
      {open && (
        <div
          className={`fixed bottom-6 right-6 z-50 w-[360px] max-h-[580px] rounded-2xl border shadow-2xl flex flex-col overflow-hidden transition-all ${panelBg} ${minimized ? 'max-h-[60px]' : ''}`}
          style={{ maxWidth: 'calc(100vw - 24px)' }}
        >
          {/* Header */}
          <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-[#2a3250] bg-gradient-to-r from-[#7367f0]/10 to-[#3d5af1]/5' : 'border-gray-100 bg-gradient-to-r from-violet-50 to-blue-50'}`}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#7367f0] to-[#3d5af1] flex items-center justify-center">
                <Bot size={16} className="text-white" />
              </div>
              <div>
                <p className={`text-xs font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Robifel AI</p>
                <p className={`text-[10px] flex items-center gap-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                  Live on Odoo
                </p>
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={resetSession} title="New chat" className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-400'}`}>
                <RefreshCw size={14} />
              </button>
              <button onClick={() => setMinimized(p => !p)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-400'}`}>
                <Minimize2 size={14} />
              </button>
              <button onClick={() => setOpen(false)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-400'}`}>
                <X size={14} />
              </button>
            </div>
          </div>

          {!minimized && (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0" style={{ maxHeight: 360 }}>
                {messages.length === 0 && !loading && (
                  <div className={`text-xs leading-relaxed rounded-2xl px-3 py-2.5 ${isDark ? 'bg-[#2a3250] text-gray-200' : 'bg-gray-100 text-gray-800'}`}>
                    Hi! I am your Robifel AI assistant, connected to your live Odoo data. Ask me about stock levels, FBF status, vendor balances, or sales -- and I can draft purchase orders for your approval.
                  </div>
                )}
                {messages.map(msg => (
                  <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs ${
                      msg.role === 'assistant'
                        ? 'bg-gradient-to-br from-[#7367f0] to-[#3d5af1]'
                        : isDark ? 'bg-[#2a3250]' : 'bg-gray-200'
                    }`}>
                      {msg.role === 'assistant' ? <Bot size={13} className="text-white" /> : <User size={13} className={isDark ? 'text-gray-300' : 'text-gray-500'} />}
                    </div>
                    <div className={`max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                      <div className={`rounded-2xl px-3 py-2.5 text-xs leading-relaxed whitespace-pre-line ${
                        msg.role === 'user'
                          ? 'bg-gradient-to-br from-[#7367f0] to-[#3d5af1] text-white rounded-tr-sm'
                          : isDark ? 'bg-[#2a3250] text-gray-200 rounded-tl-sm' : 'bg-gray-100 text-gray-800 rounded-tl-sm'
                      }`}>
                        {msg.content || '...'}
                      </div>
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#7367f0] to-[#3d5af1] flex items-center justify-center">
                      <Bot size={13} className="text-white" />
                    </div>
                    <div className={`px-3 py-2.5 rounded-2xl rounded-tl-sm flex gap-1 items-center ${isDark ? 'bg-[#2a3250]' : 'bg-gray-100'}`}>
                      {[0, 1, 2].map(i => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#7367f0] animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Proposed actions awaiting approval */}
                {pendingActions.map(a => (
                  <div key={a.id} className={`rounded-2xl border p-3 space-y-2 ${isDark ? 'bg-[#12172a] border-[#7367f0]/30' : 'bg-violet-50 border-violet-200'}`}>
                    <div className="flex items-center gap-1.5">
                      {actionIcon(a.action_type)}
                      <span className={`text-[11px] font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{a.title}</span>
                    </div>
                    {a.summary && <p className={`text-[10px] leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{a.summary}</p>}
                    <div className="flex gap-2 pt-0.5">
                      <button
                        onClick={() => runActionDecision(a.id, 'action_approve')}
                        disabled={busyAction === a.id}
                        className="flex-1 flex items-center justify-center gap-1 text-[10px] font-bold py-1.5 rounded-lg bg-green-500/15 text-green-400 border border-green-500/25 hover:bg-green-500/25 transition-all disabled:opacity-50"
                      >
                        {busyAction === a.id ? <RefreshCw size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Approve
                      </button>
                      <button
                        onClick={() => runActionDecision(a.id, 'action_reject')}
                        disabled={busyAction === a.id}
                        className="flex-1 flex items-center justify-center gap-1 text-[10px] font-bold py-1.5 rounded-lg bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/25 transition-all disabled:opacity-50"
                      >
                        <XCircle size={11} /> Reject
                      </button>
                    </div>
                  </div>
                ))}

                {/* Resolved actions */}
                {resolvedActions.map(a => (
                  <div key={a.id} className={`rounded-xl border px-3 py-2 flex items-center gap-2 text-[10px] ${
                    a.state === 'approved'
                      ? 'bg-green-500/10 border-green-500/20 text-green-400'
                      : a.state === 'failed'
                        ? 'bg-red-500/10 border-red-500/20 text-red-400'
                        : isDark ? 'bg-[#2a3250]/40 border-[#2a3250] text-gray-400' : 'bg-gray-100 border-gray-200 text-gray-500'
                  }`}>
                    {a.state === 'approved' ? <CheckCircle2 size={12} /> : a.state === 'failed' ? <AlertCircle size={12} /> : <XCircle size={12} />}
                    <span className="font-semibold">{a.title}</span>
                    <span className="ml-auto uppercase tracking-wider font-bold">{a.state}</span>
                  </div>
                ))}

                <div ref={messagesEndRef} />
              </div>

              {error && (
                <div className="px-3 pb-1">
                  <div className="flex items-start gap-2 text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1.5">
                    <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                </div>
              )}

              {/* Quick actions */}
              {messages.length === 0 && (
                <div className={`px-3 pb-2 flex gap-1.5 overflow-x-auto scrollbar-hide border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`} style={{ paddingTop: 8 }}>
                  {QUICK_ACTIONS.map(a => (
                    <button
                      key={a}
                      onClick={() => sendMessage(a)}
                      className={`flex-shrink-0 text-[10px] font-medium px-2.5 py-1.5 rounded-full border transition-all whitespace-nowrap ${
                        isDark ? 'border-[#2a3250] text-[#6a7a9a] hover:border-[#7367f0]/50 hover:text-white' : 'border-gray-200 text-gray-500 hover:border-violet-300 hover:text-violet-700'
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              )}

              {/* Input */}
              <div className={`flex gap-2 p-3 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                  placeholder="Ask about your Odoo data..."
                  className={`flex-1 rounded-xl px-3 py-2 text-xs outline-none border transition-all ${
                    isDark ? 'bg-[#12172a] border-[#2a3250] text-white placeholder:text-[#4a5580] focus:border-[#7367f0]/60' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-violet-300'
                  }`}
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || loading}
                  className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-40 transition-all hover:scale-105 flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}
                >
                  {loading ? <RefreshCw size={14} className="text-white animate-spin" /> : <Send size={14} className="text-white" />}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
