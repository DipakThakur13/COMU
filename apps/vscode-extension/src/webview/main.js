// @ts-check
(function() {
    // Acquire the vscode API
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const state = {
        taskId: null,
        prompt: null,
        modelId: '',
        status: 'idle', // idle, running, waiting_for_user, completed, failed, cancelled, offline
        events: [],
        changes: [],
        finalResponse: null,
        providers: [],
        plan: null,
        verification: null,
        diagnosis: null,
        repairAttempts: [],
        pendingInteraction: null
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
        if (state.status === 'running' || state.status === 'waiting_for_user') {
            vscode.postMessage({ type: 'cancel_task' });
        }
    }

    function requestDiff(path) {
        vscode.postMessage({ type: 'request_diff', path });
    }

    function respondInteraction(taskId, interactionId, response) {
        vscode.postMessage({
            type: 'respond_interaction',
            taskId,
            interactionId,
            response
        });
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
        const isWaiting = state.status === 'waiting_for_user';
        const isRunning = state.status === 'running' || state.status === 'starting';
        const isOffline = state.status === 'offline';

        statusDot.className = 'dot ' + (isOffline ? 'offline' : (isWaiting ? 'waiting' : (isRunning ? 'starting' : 'online')));
        statusText.innerText = isOffline ? 'Offline' : (isWaiting ? 'Waiting for User' : (isRunning ? 'Active' : 'Connected'));

        // Update inputs
        submitBtn.style.display = (isRunning || isWaiting) ? 'none' : 'flex';
        cancelBtn.style.display = (isRunning || isWaiting) ? 'block' : 'none';

        submitBtn.disabled = isOffline;
        promptInput.disabled = isRunning || isWaiting || isOffline;

        if (!state.taskId && !state.prompt) {
            return;
        }

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

        // 1. Render Interactive Prompt if Waiting for User
        if (state.pendingInteraction) {
            const pi = state.pendingInteraction;
            agentHtml += `<div class="interaction-card">`;
            agentHtml += `<div class="interaction-header">`;
            agentHtml += `<span>${pi.type === 'APPROVAL' ? '🛡️ APPROVAL REQUIRED' : '💬 INPUT REQUIRED'}</span>`;
            agentHtml += `</div>`;
            agentHtml += `<div class="interaction-title">${escapeHtml(pi.title)}</div>`;
            agentHtml += `<div class="interaction-message">${escapeHtml(pi.message)}</div>`;

            if (pi.type === 'INPUT' && pi.options && pi.options.length > 0) {
                agentHtml += `<div class="interaction-options" id="interaction-options-container">`;
                pi.options.forEach((opt, idx) => {
                    const checked = idx === 0 ? 'checked' : '';
                    agentHtml += `<label class="interaction-option"><input type="radio" name="input_opt" value="${escapeHtml(opt)}" ${checked}> <span>${escapeHtml(opt)}</span></label>`;
                });
                agentHtml += `</div>`;
                agentHtml += `<div class="interaction-actions"><button id="btn-submit-interaction-input" class="primary">Submit Choice</button></div>`;
            } else if (pi.type === 'APPROVAL') {
                agentHtml += `<div class="interaction-actions">
                    <button id="btn-approve-interaction" class="primary">✓ Approve</button>
                    <button id="btn-deny-interaction" class="danger">✕ Deny</button>
                </div>`;
            }
            agentHtml += `</div>`;
        }

        // 2. Render Plan Panel
        if (state.plan && state.plan.steps && state.plan.steps.length > 0) {
            agentHtml += `<div class="plan-panel">`;
            agentHtml += `<div class="panel-header"><span>IMPLEMENTATION PLAN · v${state.plan.version}</span> <span class="status-badge badge-${state.plan.status.toLowerCase()}">${state.plan.status}</span></div>`;
            agentHtml += `<div class="plan-steps">`;
            state.plan.steps.forEach((s, idx) => {
                let icon = '○';
                let iconClass = 'step-pending';
                if (s.status === 'COMPLETED') { icon = '✓'; iconClass = 'step-completed'; }
                else if (s.status === 'RUNNING') { icon = '●'; iconClass = 'step-running'; }
                else if (s.status === 'FAILED') { icon = '✕'; iconClass = 'step-failed'; }
                else if (s.status === 'BLOCKED') { icon = '⊘'; iconClass = 'step-blocked'; }
                else if (s.status === 'SKIPPED') { icon = '↷'; iconClass = 'step-skipped'; }

                agentHtml += `<div class="plan-step ${iconClass}">`;
                agentHtml += `<span class="step-icon">${icon}</span>`;
                agentHtml += `<div class="step-info">`;
                agentHtml += `<div class="step-title">${idx + 1}. ${escapeHtml(s.title)}</div>`;
                if (s.resultSummary) {
                    agentHtml += `<div class="step-summary">${escapeHtml(s.resultSummary)}</div>`;
                }
                agentHtml += `</div></div>`;
            });
            agentHtml += `</div></div>`;
        }

        // 3. Render Verification Panel
        if (state.verification) {
            const v = state.verification;
            agentHtml += `<div class="verification-panel">`;
            agentHtml += `<div class="panel-header"><span>VERIFICATION · ${v.status}</span> <span class="status-badge badge-${v.status.toLowerCase()}">${v.status}</span></div>`;
            agentHtml += `<div class="verification-checks">`;
            v.checks.forEach(c => {
                let cIcon = '✓';
                let cClass = 'check-passed';
                if (c.status === 'FAILED') { cIcon = '✕'; cClass = 'check-failed'; }
                else if (c.status === 'UNAVAILABLE') { cIcon = '⊘'; cClass = 'check-unavailable'; }
                else if (c.status === 'SKIPPED') { cIcon = '↷'; cClass = 'check-skipped'; }

                const reqBadge = c.required ? `<span class="badge-req">REQ</span>` : `<span class="badge-opt">OPT</span>`;
                agentHtml += `<div class="check-item ${cClass}">`;
                agentHtml += `<span>${cIcon} <strong>${escapeHtml(c.name)}</strong> ${reqBadge}</span>`;
                agentHtml += `<span class="check-details">${escapeHtml(c.skipReason || c.details || c.status)}</span>`;
                agentHtml += `</div>`;
            });
            agentHtml += `</div></div>`;
        }

        // 4. Render Failure Diagnosis if present
        if (state.diagnosis) {
            const d = state.diagnosis;
            agentHtml += `<div class="diagnosis-panel">`;
            agentHtml += `<div class="panel-header"><span>FAILURE DIAGNOSIS</span> <span class="badge-fail">${escapeHtml(d.failureType)}</span></div>`;
            agentHtml += `<div class="diag-summary">${escapeHtml(d.summary)}</div>`;
            if (d.affectedFiles && d.affectedFiles.length > 0) {
                agentHtml += `<div class="diag-files">Affected: ${d.affectedFiles.map(f => `<code>${escapeHtml(f)}</code>`).join(", ")}</div>`;
            }
            agentHtml += `</div>`;
        }

        // 5. Render Repair Attempts if present
        if (state.repairAttempts && state.repairAttempts.length > 0) {
            agentHtml += `<div class="repair-panel">`;
            agentHtml += `<div class="panel-header"><span>REPAIR ATTEMPTS</span> <span>${state.repairAttempts.length} attempt(s)</span></div>`;
            state.repairAttempts.forEach(r => {
                agentHtml += `<div class="repair-item">`;
                agentHtml += `<span>Attempt ${r.attemptNumber} · ${escapeHtml(r.changeSummary)}</span>`;
                agentHtml += `<span class="badge-${r.validationStatus.toLowerCase()}">${r.validationStatus}</span>`;
                agentHtml += `</div>`;
            });
            agentHtml += `</div>`;
        }

        // 5b. Render Supervised Worker Agents
        if (state.subagents && state.subagents.length > 0) {
            agentHtml += `<div class="subagents-panel" style="margin-top: 10px; background: rgba(255,255,255,0.03); border: 1px solid var(--comu-border); border-radius: 6px; padding: 10px;">`;
            agentHtml += `<div style="font-size: 11px; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">🤖 Supervised Workers · ${state.subagents.length}</div>`;
            state.subagents.forEach(sub => {
                const statusColor = sub.status === 'COMPLETED' ? 'var(--comu-accent)' : sub.status === 'RUNNING' ? '#e5c07b' : 'var(--comu-error)';
                agentHtml += `<div style="padding: 6px; border-left: 2px solid ${statusColor}; margin-bottom: 6px; background: rgba(0,0,0,0.15);">
                    <div style="display: flex; justify-content: space-between; font-size: 11px;">
                        <strong>${escapeHtml(sub.subagentType)} WORKER</strong>
                        <span style="color: ${statusColor}; font-weight: 500;">${escapeHtml(sub.status)}</span>
                    </div>
                    <div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">Goal: ${escapeHtml(sub.goal)}</div>
                    ${sub.findings ? `<div style="font-size: 10px; opacity: 0.7; margin-top: 4px; white-space: pre-wrap;">${escapeHtml(sub.findings.slice(0, 150))}...</div>` : ''}
                </div>`;
            });
            agentHtml += `</div>`;
        }

        // 5c. Render Git Commit Proposal
        if (state.gitCommitProposal) {
            agentHtml += `<div class="git-proposal-card" style="margin-top: 12px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 6px; padding: 12px;">`;
            agentHtml += `<div style="font-size: 12px; font-weight: 600; color: #38bdf8; display: flex; align-items: center; gap: 6px;">
                <span>📦 GIT COMMIT PROPOSAL</span>
            </div>`;
            agentHtml += `<div style="margin-top: 6px; font-size: 12px;"><strong>Proposed Message:</strong> <input type="text" id="git-commit-msg-input" value="${escapeHtml(state.gitCommitProposal.message)}" style="width: 100%; margin-top: 4px; padding: 4px 6px; background: var(--comu-input-bg); border: 1px solid var(--comu-border); color: var(--comu-fg); border-radius: 4px;" /></div>`;
            agentHtml += `<div style="margin-top: 6px; font-size: 11px; opacity: 0.8;">Files to stage (${state.gitCommitProposal.files.length}): ${state.gitCommitProposal.files.map(f => escapeHtml(f)).join(', ')}</div>`;
            agentHtml += `<div style="margin-top: 10px; display: flex; gap: 8px;">
                <button id="btn-approve-commit" class="primary" style="padding: 4px 12px; font-size: 11px;">Approve Commit</button>
                <button id="btn-deny-commit" style="padding: 4px 12px; font-size: 11px;">Deny</button>
            </div>`;
            agentHtml += `</div>`;
        }

        // 5d. Render Git Push Proposal
        if (state.gitPushProposal) {
            agentHtml += `<div class="git-push-card" style="margin-top: 12px; background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.3); border-radius: 6px; padding: 12px;">`;
            agentHtml += `<div style="font-size: 12px; font-weight: 600; color: #eab308;">🚀 GIT PUSH AUTHORIZATION REQUIRED</div>`;
            agentHtml += `<div style="margin-top: 6px; font-size: 12px;">Remote: <strong>${escapeHtml(state.gitPushProposal.remote)}</strong> · Branch: <strong>${escapeHtml(state.gitPushProposal.branch)}</strong></div>`;
            agentHtml += `<div style="margin-top: 2px; font-size: 11px; opacity: 0.8;">Commit: <code>${escapeHtml(state.gitPushProposal.commitHash)}</code></div>`;
            agentHtml += `<div style="margin-top: 10px; display: flex; gap: 8px;">
                <button id="btn-approve-push" class="primary" style="padding: 4px 12px; font-size: 11px;">Approve Push</button>
                <button id="btn-deny-push" style="padding: 4px 12px; font-size: 11px;">Deny</button>
            </div>`;
            agentHtml += `</div>`;
        }

        // 6. Render Final Response
        if (state.finalResponse) {
            agentHtml += `<div style="margin-top: 12px; font-size: 13px;">${escapeHtml(state.finalResponse)}</div>`;
        }

        // 7. Render Changes Panel
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

        // Attach listeners to interaction buttons
        const submitInputBtn = document.getElementById('btn-submit-interaction-input');
        if (submitInputBtn && state.pendingInteraction) {
            submitInputBtn.addEventListener('click', () => {
                const selectedRadio = document.querySelector('input[name="input_opt"]:checked');
                // @ts-ignore
                const val = selectedRadio ? selectedRadio.value : '';
                respondInteraction(state.taskId, state.pendingInteraction.interactionId, { type: 'INPUT', value: val });
            });
        }

        const approveBtn = document.getElementById('btn-approve-interaction');
        if (approveBtn && state.pendingInteraction) {
            approveBtn.addEventListener('click', () => {
                respondInteraction(state.taskId, state.pendingInteraction.interactionId, { type: 'APPROVE' });
            });
        }

        const denyBtn = document.getElementById('btn-deny-interaction');
        if (denyBtn && state.pendingInteraction) {
            denyBtn.addEventListener('click', () => {
                respondInteraction(state.taskId, state.pendingInteraction.interactionId, { type: 'DENY' });
            });
        }

        // Attach listeners to Git buttons
        const approveCommitBtn = document.getElementById('btn-approve-commit');
        if (approveCommitBtn && state.taskId) {
            approveCommitBtn.addEventListener('click', () => {
                const msgInput = document.getElementById('git-commit-msg-input');
                // @ts-ignore
                const msg = msgInput ? msgInput.value : undefined;
                vscode.postMessage({ type: 'approve_commit', taskId: state.taskId, message: msg });
            });
        }

        const denyCommitBtn = document.getElementById('btn-deny-commit');
        if (denyCommitBtn && state.taskId) {
            denyCommitBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'deny_commit', taskId: state.taskId });
            });
        }

        const approvePushBtn = document.getElementById('btn-approve-push');
        if (approvePushBtn && state.taskId) {
            approvePushBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'approve_push', taskId: state.taskId });
            });
        }

        const denyPushBtn = document.getElementById('btn-deny-push');
        if (denyPushBtn && state.taskId) {
            denyPushBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'deny_push', taskId: state.taskId });
            });
        }

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
