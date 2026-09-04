// @ts-check
(function() {
    // Acquire the vscode API
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const state = {
        taskId: null,
        prompt: null,
        modelId: '',
        status: 'idle', // idle, running, completed, failed, cancelled, offline
        events: [],
        changes: [],
        finalResponse: null,
        providers: []
    };

    // DOM Elements - Main View
    const mainView = document.getElementById('main-view');
    const chatContainer = document.getElementById('chat-container');
    const promptInput = document.getElementById('prompt-input');
    const submitBtn = document.getElementById('submit-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const modelSelect = document.getElementById('model-select');
    const statusDot = document.getElementById('runtime-status-dot');
    const statusText = document.getElementById('runtime-status-text');
    const settingsBtn = document.getElementById('settings-btn');
    const emptyStateChips = document.querySelectorAll('.chip');

    // DOM Elements - Settings View
    const settingsView = document.getElementById('settings-view');
    const backBtn = document.getElementById('back-btn');
    const providersContainer = document.getElementById('providers-container');

    // Event Listeners
    submitBtn.addEventListener('click', submitPrompt);
    cancelBtn.addEventListener('click', cancelTask);
    
    settingsBtn.addEventListener('click', () => {
        mainView.style.display = 'none';
        settingsView.style.display = 'flex';
        vscode.postMessage({ type: 'request_providers' });
    });

    backBtn.addEventListener('click', () => {
        settingsView.style.display = 'none';
        mainView.style.display = 'flex';
    });

    emptyStateChips.forEach(chip => {
        chip.addEventListener('click', () => {
            promptInput.value = chip.getAttribute('data-prompt');
            promptInput.focus();
        });
    });
    
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitPrompt();
        }
    });

    modelSelect.addEventListener('change', (e) => {
        state.modelId = e.target.value;
        vscode.postMessage({ type: 'select_model', modelId: state.modelId });
    });

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'state_update':
                Object.assign(state, message.state);
                renderState();
                break;
            case 'error':
                appendError(message.message);
                break;
            case 'providers_update':
                state.providers = message.providers;
                renderProviders();
                renderModels();
                break;
        }
    });

    function submitPrompt() {
        const text = promptInput.value.trim();
        if (!text || state.status === 'running') return;
        
        if (!state.modelId) {
            appendError("No model selected. Please configure a provider in Settings.");
            return;
        }

        vscode.postMessage({
            type: 'submit_prompt',
            prompt: text,
            modelId: state.modelId
        });

        promptInput.value = '';
    }

    function cancelTask() {
        if (state.status === 'running') {
            vscode.postMessage({ type: 'cancel_task' });
        }
    }

    function requestDiff(path) {
        vscode.postMessage({ type: 'request_diff', path });
    }

    function renderModels() {
        modelSelect.innerHTML = '';
        let hasModels = false;

        state.providers.forEach(p => {
            if (p.configured && p.models && p.models.length > 0) {
                const group = document.createElement('optgroup');
                group.label = p.displayName;
                p.models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.name;
                    group.appendChild(opt);
                    hasModels = true;
                });
                modelSelect.appendChild(group);
            }
        });

        if (!hasModels) {
            const opt = document.createElement('option');
            opt.value = "";
            opt.disabled = true;
            opt.selected = true;
            opt.textContent = "No models configured";
            modelSelect.appendChild(opt);
        } else {
            // retain selection
            if (state.modelId && modelSelect.querySelector(`option[value="${state.modelId}"]`)) {
                modelSelect.value = state.modelId;
            } else {
                state.modelId = modelSelect.options[0].value;
                vscode.postMessage({ type: 'select_model', modelId: state.modelId });
            }
        }
    }

    function renderProviders() {
        providersContainer.innerHTML = '';

        state.providers.forEach(p => {
            const section = document.createElement('div');
            section.className = 'provider-section';

            const statusHtml = p.configured ? 
                `<span style="color: var(--comu-success)">●</span> Configured` : 
                `<span style="color: var(--comu-warning)">○</span> Not configured`;

            const header = document.createElement('div');
            header.className = 'provider-header';
            header.innerHTML = `
                <span>${escapeHtml(p.displayName)}</span>
                <span class="provider-status">${statusHtml}</span>
            `;
            section.appendChild(header);

            if (!p.isLocal) {
                const body = document.createElement('div');
                body.className = 'provider-body';

                const inputContainer = document.createElement('div');
                const label = document.createElement('div');
                label.style.marginBottom = '4px';
                label.style.fontSize = '11px';
                label.textContent = 'API Key';
                
                const input = document.createElement('input');
                input.type = 'password';
                input.placeholder = p.configured ? '••••••••••••••••' : 'Enter API Key';
                input.id = `api-key-${p.id}`;
                
                inputContainer.appendChild(label);
                inputContainer.appendChild(input);
                body.appendChild(inputContainer);

                const actions = document.createElement('div');
                actions.className = 'provider-actions';

                const saveBtn = document.createElement('button');
                saveBtn.className = 'primary';
                saveBtn.textContent = 'Save';
                saveBtn.onclick = () => {
                    const val = input.value.trim();
                    if (val) {
                        vscode.postMessage({ type: 'save_provider_key', providerId: p.id, key: val });
                        input.value = '';
                    }
                };
                
                const testBtn = document.createElement('button');
                testBtn.textContent = 'Test Connection';
                testBtn.disabled = !p.configured;
                testBtn.onclick = () => {
                    vscode.postMessage({ type: 'test_provider', providerId: p.id });
                };

                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'Remove';
                removeBtn.style.color = 'var(--comu-error)';
                removeBtn.style.display = p.configured ? 'block' : 'none';
                removeBtn.onclick = () => {
                    vscode.postMessage({ type: 'remove_provider_key', providerId: p.id });
                };

                actions.appendChild(saveBtn);
                actions.appendChild(testBtn);
                actions.appendChild(removeBtn);

                body.appendChild(actions);
                section.appendChild(body);
            } else {
                const body = document.createElement('div');
                body.className = 'provider-body';
                body.innerHTML = `<span style="opacity: 0.7; font-size: 11px;">Local provider. No API key required.</span>`;
                section.appendChild(body);
            }

            providersContainer.appendChild(section);
        });
    }

    function renderState() {
        // Update header status
        statusDot.className = 'dot ' + (state.status === 'offline' ? 'offline' : (state.status === 'idle' || state.status === 'completed' || state.status === 'cancelled' || state.status === 'failed' ? 'online' : 'starting'));
        statusText.innerText = state.status === 'offline' ? 'Offline' : (state.status === 'idle' || state.status === 'completed' || state.status === 'cancelled' || state.status === 'failed' ? 'Connected' : 'Active');

        // Update inputs
        const isRunning = state.status === 'running' || state.status === 'starting';
        const isOffline = state.status === 'offline';
        submitBtn.style.display = isRunning ? 'none' : 'flex';
        cancelBtn.style.display = isRunning ? 'block' : 'none';
        
        submitBtn.disabled = isOffline;
        promptInput.disabled = isRunning || isOffline;

        if (!state.taskId && !state.prompt) {
            // Reset to empty state (it is already in HTML, we just toggle visibility)
            // But wait, the empty state is wiped if chatContainer.innerHTML = ''
            // Instead, we just won't clear if it's new
            return;
        }

        // Render chat
        chatContainer.innerHTML = '';

        // Render User Bubble
        const userMsg = document.createElement('div');
        userMsg.className = 'message user';
        userMsg.innerHTML = `
            <div class="message-label">You</div>
            <div class="bubble">${escapeHtml(state.prompt || '')}</div>
        `;
        chatContainer.appendChild(userMsg);

        // Render Agent Output
        const agentMsg = document.createElement('div');
        agentMsg.className = 'message agent';
        
        let agentHtml = `<div class="message-label"><span style="color: var(--comu-accent)">✦</span> COMU</div>`;
        agentHtml += `<div class="bubble">`;
        
        // Render events
        if (state.events && state.events.length > 0) {
            agentHtml += `<div class="event-list">`;
            state.events.forEach(ev => {
                if (ev.type === 'agent.status') {
                    agentHtml += `<div class="event-item"><span class="event-icon icon-spin">●</span> <span class="event-details"><span class="event-name">${escapeHtml(ev.status)}</span></span></div>`;
                } else if (ev.type === 'tool.started') {
                    agentHtml += `<div class="event-item"><span class="event-icon icon-spin">●</span> <span class="event-details"><span class="event-name">${escapeHtml(ev.tool)}</span><span class="event-meta">Running...</span></span></div>`;
                } else if (ev.type === 'tool.completed') {
                    agentHtml += `<div class="event-item"><span class="event-icon event-success">✓</span> <span class="event-details"><span class="event-name">${escapeHtml(ev.tool)}</span></span></div>`;
                } else if (ev.type === 'command.started') {
                    agentHtml += `<div class="event-item"><span class="event-icon icon-spin">▶</span> <span class="event-details"><span class="event-name">Executing Command</span><span class="event-meta">Running...</span></span></div>`;
                } else if (ev.type === 'command.completed') {
                    agentHtml += `<div class="event-item"><span class="event-icon event-success">✓</span> <span class="event-details"><span class="event-name">Command Completed</span></span></div>`;
                } else if (ev.type === 'command.failed') {
                    agentHtml += `<div class="event-item"><span class="event-icon event-error">✕</span> <span class="event-details"><span class="event-name">Command Failed</span></span></div>`;
                } else if (ev.type === 'command.timeout') {
                    agentHtml += `<div class="event-item"><span class="event-icon event-error">⏱</span> <span class="event-details"><span class="event-name">Command Timed Out</span></span></div>`;
                } else if (ev.type === 'command.cancelled') {
                    agentHtml += `<div class="event-item"><span class="event-icon event-error">■</span> <span class="event-details"><span class="event-name">Command Cancelled</span></span></div>`;
                } else if (ev.type === 'task.completed') {
                    agentHtml += `<div class="event-item"><span class="event-icon event-success">✓</span> <span class="event-details"><span class="event-name">Task completed</span></span></div>`;
                } else if (ev.type === 'task.failed') {
                    agentHtml += `<div class="event-item"><span class="event-icon event-error">✕</span> <span class="event-details"><span class="event-name">Failed</span><span class="event-meta">${escapeHtml(ev.error)}</span></span></div>`;
                } else if (ev.type === 'task.cancelled') {
                    agentHtml += `<div class="event-item"><span class="event-icon event-error">■</span> <span class="event-details"><span class="event-name">Task cancelled</span></span></div>`;
                }
            });
            agentHtml += `</div>`;
        }

        // Render Final Response if any
        if (state.finalResponse) {
            agentHtml += `<div style="margin-top: 12px; font-size: 13px;">${escapeHtml(state.finalResponse)}</div>`;
        }

        // Render Changes Panel
        if (state.changes && state.changes.length > 0) {
            agentHtml += `<div class="changes-panel">`;
            agentHtml += `<div class="changes-header">CHANGES · ${state.changes.length}</div>`;
            state.changes.forEach(c => {
                const op = c.operation === 'CREATE' ? 'A' : 'M';
                agentHtml += `<div class="change-item" data-path="${escapeHtml(c.path)}">
                    <div><span class="change-op op-${c.operation}">${op}</span> ${escapeHtml(c.path)}</div>
                    <div style="opacity: 0.5;">[Diff]</div>
                </div>`;
            });
            agentHtml += `</div>`;
        }

        agentHtml += `</div>`;
        agentMsg.innerHTML = agentHtml;
        
        chatContainer.appendChild(agentMsg);

        // Attach listeners to diff buttons
        const changeItems = chatContainer.querySelectorAll('.change-item');
        changeItems.forEach(item => {
            item.addEventListener('click', () => {
                requestDiff(item.getAttribute('data-path'));
            });
        });

        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function appendError(msg) {
        const errorDiv = document.createElement('div');
        errorDiv.style.color = 'var(--comu-error)';
        errorDiv.style.padding = '10px';
        errorDiv.style.fontSize = '12px';
        errorDiv.innerText = msg;
        chatContainer.appendChild(errorDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function escapeHtml(unsafe) {
        return (unsafe || '').toString()
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // Request providers and signal ready
    vscode.postMessage({ type: 'request_providers' });
    vscode.postMessage({ type: 'ready' });

})();
