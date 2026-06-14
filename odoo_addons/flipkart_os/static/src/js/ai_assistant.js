/** @odoo-module **/

import { Component, onPatched, onWillStart, useRef, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { useService } from "@web/core/utils/hooks";

class FlipkartAIAssistant extends Component {
    static template = "flipkart_os.AIAssistant";

    setup() {
        this.notification = useService("notification");
        this.action = useService("action");
        this.messagesRef = useRef("messages");
        this.state = useState({
            sessions: [],
            currentSession: null,
            messages: [],
            actions: [],
            settings: {},
            input: "",
            loading: false,
            error: "",
            sidebarOpen: window.innerWidth > 768,
        });
        onWillStart(async () => {
            await this.loadBootstrap();
        });
        onPatched(() => this.scrollMessagesToBottom());
    }

    async loadBootstrap(sessionId = null) {
        const data = await rpc("/flipkart_os/ai/bootstrap", { session_id: sessionId });
        this.state.sessions = data.sessions || [];
        this.state.currentSession = data.current_session || null;
        this.state.messages = data.messages || [];
        this.state.actions = data.actions || [];
        this.state.settings = data.settings || {};
        this.scrollMessagesToBottom();
    }

    async newSession() {
        const data = await rpc("/flipkart_os/ai/session/new", {});
        this.state.currentSession = data.session;
        this.state.messages = data.messages || [];
        this.state.actions = data.actions || [];
        await this.loadBootstrap(data.session.id);
    }

    async loadSession(session) {
        if (!session || this.state.loading) return;
        const data = await rpc("/flipkart_os/ai/session/load", { session_id: session.id });
        if (data.error) {
            this.notify(data.error, "danger");
            return;
        }
        this.state.currentSession = data.session;
        this.state.messages = data.messages || [];
        this.state.actions = data.actions || [];
        this.closeSidebarOnMobile();
    }

    async deleteCurrentSession() {
        if (!this.state.currentSession || this.state.loading) return;
        if (!window.confirm("Delete this chat history?")) return;
        const data = await rpc("/flipkart_os/ai/session/delete", { session_id: this.state.currentSession.id });
        if (data.error) {
            this.notify(data.error, "danger");
            return;
        }
        this.state.sessions = data.sessions || [];
        this.state.currentSession = data.current_session || null;
        this.state.messages = data.messages || [];
        this.state.actions = data.actions || [];
        this.notify("Chat deleted.", "success");
        this.closeSidebarOnMobile();
    }

    async sendMessage() {
        const content = (this.state.input || "").trim();
        if (!content || !this.state.currentSession || this.state.loading) return;
        this.state.loading = true;
        this.state.error = "";
        this.state.input = "";
        this.state.messages.push({ role: "user", content });
        try {
            const data = await rpc("/flipkart_os/ai/message/send", {
                session_id: this.state.currentSession.id,
                content,
            });
            if (data.error) {
                throw new Error(data.error);
            }
            this.state.currentSession = data.session || this.state.currentSession;
            this.state.messages = data.messages || this.state.messages;
            this.state.actions = data.actions || [];
            await this.loadBootstrap(this.state.currentSession.id);
            this.scrollMessagesToBottom();
        } catch (error) {
            this.state.error = error.message || String(error);
            this.notify(this.state.error, "danger");
        } finally {
            this.state.loading = false;
        }
    }

    async usePrompt(prompt) {
        this.state.input = prompt;
        await this.sendMessage();
    }

    async approveAction(item) {
        if (!item || item.state !== "proposed") return;
        try {
            const data = await rpc("/flipkart_os/ai/action/approve", { action_id: item.id });
            if (data.error) throw new Error(data.error);
            await this.refreshCurrent();
            this.notify("Draft action created.", "success");
        } catch (error) {
            this.notify(error.message || String(error), "danger");
            await this.refreshCurrent();
        }
    }

    async rejectAction(item) {
        if (!item || item.state !== "proposed") return;
        const data = await rpc("/flipkart_os/ai/action/reject", { action_id: item.id });
        if (data.error) {
            this.notify(data.error, "danger");
        }
        await this.refreshCurrent();
    }

    async refreshCurrent() {
        if (this.state.currentSession) {
            await this.loadSession(this.state.currentSession);
        }
    }

    openResult(item) {
        if (!item.result_model || !item.result_res_id) return;
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: item.result_model,
            res_id: item.result_res_id,
            views: [[false, "form"]],
            target: "current",
        });
    }

    notify(message, type = "info") {
        this.notification.add(message, { type });
    }

    onKeydown(ev) {
        if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault();
            this.sendMessage();
        }
    }

    toggleSidebar() {
        this.state.sidebarOpen = !this.state.sidebarOpen;
    }

    closeSidebarOnMobile() {
        if (window.innerWidth <= 768) {
            this.state.sidebarOpen = false;
        }
    }

    scrollMessagesToBottom() {
        const element = this.messagesRef.el;
        if (!element) return;
        window.requestAnimationFrame(() => {
            element.scrollTop = element.scrollHeight;
        });
    }

    get pendingActions() {
        return (this.state.actions || []).filter((item) => item.state === "proposed");
    }

    get pastActions() {
        return (this.state.actions || []).filter((item) => item.state !== "proposed");
    }
}

registry.category("actions").add("flipkart_ai_assistant", FlipkartAIAssistant);
