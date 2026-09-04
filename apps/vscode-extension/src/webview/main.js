// @ts-check
(function() {
    // Acquire the vscode API safely (supports VS Code Webview and Live Preview)
    // @ts-ignore
    const vscode = (typeof acquireVsCodeApi === 'function')
        ? acquireVsCodeApi()
        : { postMessage: (msg) => console.log('[Live Preview postMessage]:', msg) };

    const isLivePreview = typeof acquireVsCodeApi !== 'function';

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
        pendingInteraction: null,
        gitCommitProposal: null,
        gitCommitResult: null,
        gitPushProposal: null,
        gitPushResult: null,
        subagents: []
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
    const configureModelBtn = document.getElementById('configure-model-btn');
    const emptyStateChips = document.querySelectorAll('.chip');

    // DOM Elements - Onboarding & Settings View
    const btnOnboardingNvidia = document.getElementById('btn-onboarding-nvidia');
    const btnOnboardingOther = document.getElementById('btn-onboarding-other');
    const btnOnboardingLocal = document.getElementById('btn-onboarding-local');
    const settingsView = document.getElementById('settings-view');
    const backBtn = document.getElementById('back-btn');
    const providersContainer = document.getElementById('providers-container');

    // Event Listeners - Chat & Main View
    submitBtn.addEventListener('click', submitPrompt);
    cancelBtn.addEventListener('click', cancelTask);

    settingsBtn.addEventListener('click', () => openSettingsView());
    if (configureModelBtn) {
        configureModelBtn.addEventListener('click', () => openSettingsView());
    }
    backBtn.addEventListener('click', () => closeSettingsView());

    if (btnOnboardingNvidia) {
        btnOnboardingNvidia.addEventListener('click', () => openSettingsView('nvidia'));
    }
    if (btnOnboardingOther) {
        btnOnboardingOther.addEventListener('click', () => openSettingsView());
    }
    if (btnOnboardingLocal) {
        btnOnboardingLocal.addEventListener('click', () => openSettingsView('ollama'));
    }

    emptyStateChips.forEach(chip => {
        chip.addEventListener('click', () => {
            promptInput.value = chip.getAttribute('data-prompt') || '';
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
                state.providers = message.providers || [];
                renderProviders();
                renderModels();
                updateOnboardingState();
                break;
            case 'provider_test_result':
                handleProviderTestResult(message.providerId, message.result);
                break;
            case 'open_settings':
                openSettingsView(message.targetProviderId);
                break;
        }
    });

    function openSettingsView(targetProviderId) {
        mainView.style.display = 'none';
        settingsView.style.display = 'flex';
        vscode.postMessage({ type: 'request_providers' });

        if (targetProviderId) {
            setTimeout(() => {
                const targetCard = document.getElementById(`provider-card-${targetProviderId}`);
                if (targetCard) {
                    targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetCard.classList.add('highlight-pulse');
                    setTimeout(() => targetCard.classList.remove('highlight-pulse'), 2000);
                }
            }, 100);
        }
    }

    function closeSettingsView() {
        settingsView.style.display = 'none';
        mainView.style.display = 'flex';
    }

    function submitPrompt() {
        const text = promptInput.value.trim();
        if (!text || state.status === 'running') return;

        if (!state.modelId) {
            appendError("No model selected. Please configure a provider in Settings.");
            openSettingsView();
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

    function updateOnboardingState() {
        const onboardingCard = document.getElementById('byok-onboarding-card');
        if (!onboardingCard) return;

        const hasConfiguredCloud = state.providers.some(p => !p.isLocal && p.hasCredential);

        if (hasConfiguredCloud) {
            onboardingCard.innerHTML = `
                <div class="byok-badge active">● PROVIDER CONNECTED</div>
                <div class="byok-title">Ready for Autonomous Engineering</div>
                <p class="byok-desc">COMU is connected to your AI provider account. Select your model below or manage API keys in Settings.</p>
                <div class="byok-actions">
                    <button id="btn-onboarding-manage" class="byok-btn secondary">Manage Providers & Keys</button>
                </div>
            `;
            const manageBtn = document.getElementById('btn-onboarding-manage');
            if (manageBtn) {
                manageBtn.addEventListener('click', () => openSettingsView());
            }
        }
    }

    function renderModels() {
        modelSelect.innerHTML = '';
        let hasModels = false;

        state.providers.forEach(p => {
            const isReady = p.hasCredential || p.isLocal;
            if (p.models && p.models.length > 0) {
                const group = document.createElement('optgroup');
                group.label = p.displayName + (isReady ? '' : ' (Not Configured)');
                p.models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.name + (isReady ? '' : ' ⚠️ (Needs Key)');
                    opt.dataset.providerId = p.providerId;
                    opt.dataset.configured = isReady ? 'true' : 'false';
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
            opt.textContent = "No models available - Click ⚙ to configure";
            modelSelect.appendChild(opt);
        } else {
            if (state.modelId && modelSelect.querySelector(`option[value="${state.modelId}"]`)) {
                modelSelect.value = state.modelId;
            } else {
                const preferred = modelSelect.querySelector('option[data-configured="true"]') || modelSelect.options[0];
                if (preferred) {
                    modelSelect.value = preferred.value;
                    state.modelId = preferred.value;
                }
            }
        }
    }

    function renderProviders() {
        providersContainer.innerHTML = '';

        state.providers.forEach(p => {
            const card = document.createElement('div');
            card.className = 'provider-card';
            card.id = `provider-card-${p.providerId}`;

            let statusClass = 'unconfigured';
            let statusText = 'Not Configured';
            let statusIcon = '○';

            if (p.status === 'CONNECTED' || (p.hasCredential && p.status !== 'INVALID_CREDENTIAL' && p.status !== 'NETWORK_ERROR')) {
                statusClass = 'connected';
                statusText = 'Connected';
                statusIcon = '●';
            } else if (p.status === 'CONNECTING') {
                statusClass = 'connecting';
                statusText = 'Testing...';
                statusIcon = '◌';
            } else if (p.status === 'INVALID_CREDENTIAL') {
                statusClass = 'invalid';
                statusText = 'Invalid Key';
                statusIcon = '✕';
            } else if (p.status === 'NETWORK_ERROR') {
                statusClass = 'error';
                statusText = 'Network Error';
                statusIcon = '✕';
            }

            const tagText = p.isLocal ? 'Local / On-Device' : (p.providerId === 'nvidia' ? 'Cloud (Nemotron 3 Ultra)' : 'Cloud');

            let cardHtml = `
                <div class="provider-card-header">
                    <div class="provider-card-title-group">
                        <span class="provider-card-icon">${p.providerId === 'nvidia' ? '✦' : (p.isLocal ? '🦙' : '⚡')}</span>
                        <span class="provider-card-name">${escapeHtml(p.displayName)}</span>
                        <span class="provider-type-tag">${tagText}</span>
                    </div>
                    <div class="status-pill status-${statusClass}">
                        <span class="status-dot">${statusIcon}</span>
                        <span class="status-text">${statusText}</span>
                    </div>
                </div>
                <div class="provider-card-desc">${escapeHtml(p.description || '')}</div>
            `;

            if (p.environmentDetected) {
                cardHtml += `
                    <div class="env-detected-badge">
                        <span>ℹ</span>
                        <span>Detected in environment variable (<code>NVIDIA_API_KEY</code>). You can override it by entering a key below.</span>
                    </div>
                `;
            }

            if (!p.isLocal) {
                cardHtml += `
                    <div class="provider-form">
                        <div class="form-group">
                            <div class="form-label-row">
                                <label for="input-key-${p.providerId}">API Key</label>
                                ${p.providerId === 'nvidia' ? '<a href="https://build.nvidia.com/" target="_blank" class="get-key-link">Get an NVIDIA API key ↗</a>' : ''}
                            </div>
                            <div class="input-with-toggle">
                                <input type="password" id="input-key-${p.providerId}" 
                                    placeholder="${p.hasCredential ? '••••••••••••••••••••' : 'Enter API Key (e.g. nvapi-...)'}" 
                                    autocomplete="off" spellcheck="false">
                                <button type="button" class="btn-toggle-eye" id="toggle-eye-${p.providerId}" title="Show / Hide Key">👁</button>
                            </div>
                            <div class="input-helper">Stored securely in VS Code <code>SecretStorage</code>. Never logged or exposed.</div>
                        </div>

                        <div class="form-group">
                            <label for="input-endpoint-${p.providerId}">Endpoint URL</label>
                            <input type="text" id="input-endpoint-${p.providerId}" 
                                value="${escapeHtml(p.endpoint || '')}" 
                                placeholder="Default: ${p.defaultEndpoint || 'https://...'}" 
                                autocomplete="off" spellcheck="false">
                        </div>

                        <div class="test-result-container" id="test-result-${p.providerId}" style="display: none;"></div>

                        <div class="provider-card-actions">
                            <button id="btn-save-${p.providerId}" class="byok-action-btn primary">Save</button>
                            <button id="btn-test-${p.providerId}" class="byok-action-btn secondary">Test Connection</button>
                            ${p.hasCredential ? `<button id="btn-remove-${p.providerId}" class="byok-action-btn danger">Remove</button>` : ''}
                        </div>
                    </div>
                `;
            } else {
                cardHtml += `
                    <div class="provider-form">
                        <div class="form-group">
                            <label>Local Endpoint</label>
                            <input type="text" value="${escapeHtml(p.endpoint || 'http://localhost:11434')}" readonly style="opacity: 0.8;">
                        </div>
                        <div class="test-result-container" id="test-result-${p.providerId}" style="display: none;"></div>
                        <div class="provider-card-actions">
                            <button id="btn-test-${p.providerId}" class="byok-action-btn secondary">Test Connection</button>
                        </div>
                    </div>
                `;
            }

            card.innerHTML = cardHtml;
            providersContainer.appendChild(card);

            // Attach event listeners for this card
            if (!p.isLocal) {
                const keyInput = card.querySelector(`#input-key-${p.providerId}`);
                const endpointInput = card.querySelector(`#input-endpoint-${p.providerId}`);
                const toggleEyeBtn = card.querySelector(`#toggle-eye-${p.providerId}`);
                const saveBtn = card.querySelector(`#btn-save-${p.providerId}`);
                const testBtn = card.querySelector(`#btn-test-${p.providerId}`);
                const removeBtn = card.querySelector(`#btn-remove-${p.providerId}`);

                if (toggleEyeBtn && keyInput) {
                    toggleEyeBtn.addEventListener('click', () => {
                        if (keyInput.type === 'password') {
                            keyInput.type = 'text';
                            toggleEyeBtn.textContent = '🔒';
                        } else {
                            keyInput.type = 'password';
                            toggleEyeBtn.textContent = '👁';
                        }
                    });
                }

                if (saveBtn) {
                    saveBtn.addEventListener('click', () => {
                        const keyVal = keyInput ? keyInput.value.trim() : '';
                        const endpointVal = endpointInput ? endpointInput.value.trim() : undefined;
                        if (!keyVal && !p.hasCredential) {
                            const resEl = document.getElementById(`test-result-${p.providerId}`);
                            if (resEl) {
                                resEl.style.display = 'block';
                                resEl.className = 'test-result-container error';
                                resEl.textContent = 'Please enter an API key to save.';
                            }
                            return;
                        }
                        if (keyVal) {
                            vscode.postMessage({
                                type: 'save_provider_key',
                                providerId: p.providerId,
                                key: keyVal,
                                endpoint: endpointVal
                            });
                            keyInput.value = '';
                        } else if (endpointVal !== undefined) {
                            vscode.postMessage({
                                type: 'save_provider_key',
                                providerId: p.providerId,
                                key: '',
                                endpoint: endpointVal
                            });
                        }
                    });
                }

                if (testBtn) {
                    testBtn.addEventListener('click', () => {
                        setTestingState(p.providerId);
                        vscode.postMessage({ type: 'test_provider', providerId: p.providerId });
                    });
                }

                if (removeBtn) {
                    removeBtn.addEventListener('click', () => {
                        vscode.postMessage({ type: 'remove_provider_key', providerId: p.providerId });
                    });
                }
            } else {
                const testBtn = card.querySelector(`#btn-test-${p.providerId}`);
                if (testBtn) {
                    testBtn.addEventListener('click', () => {
                        setTestingState(p.providerId);
                        vscode.postMessage({ type: 'test_provider', providerId: p.providerId });
                    });
                }
            }
        });
    }

    function setTestingState(providerId) {
        const card = document.getElementById(`provider-card-${providerId}`);
        if (!card) return;
        const statusPill = card.querySelector('.status-pill');
        if (statusPill) {
            statusPill.className = 'status-pill status-connecting';
            statusPill.innerHTML = '<span class="status-dot spin">◌</span><span class="status-text">Testing...</span>';
        }
        const testResultEl = document.getElementById(`test-result-${providerId}`);
        if (testResultEl) {
            testResultEl.style.display = 'block';
            testResultEl.className = 'test-result-container testing';
            testResultEl.innerHTML = '<span class="spin">◌</span> Testing connection...';
        }
    }

    function handleProviderTestResult(providerId, result) {
        const card = document.getElementById(`provider-card-${providerId}`);
        if (!card) return;

        const isConnected = result.status === 'CONNECTED';
        const statusPill = card.querySelector('.status-pill');
        if (statusPill) {
            if (isConnected) {
                statusPill.className = 'status-pill status-connected';
                statusPill.innerHTML = '<span class="status-dot">●</span><span class="status-text">Connected</span>';
            } else {
                const isInvalid = result.status === 'INVALID_CREDENTIAL';
                statusPill.className = `status-pill status-${isInvalid ? 'invalid' : 'error'}`;
                statusPill.innerHTML = `<span class="status-dot">✕</span><span class="status-text">${isInvalid ? 'Invalid Key' : 'Connection Failed'}</span>`;
            }
        }

        const testResultEl = document.getElementById(`test-result-${providerId}`);
        if (testResultEl) {
            testResultEl.style.display = 'block';
            if (isConnected) {
                testResultEl.className = 'test-result-container success';
                const latencyStr = result.latencyMs ? ` (${result.latencyMs}ms)` : '';
                const modelStr = result.model ? ` · Model: ${escapeHtml(result.model)}` : '';
                testResultEl.innerHTML = `✓ <strong>Connected successfully</strong>${latencyStr}${modelStr}`;
            } else {
                testResultEl.className = 'test-result-container error';
                testResultEl.innerHTML = `✕ <strong>Connection failed:</strong> ${escapeHtml(result.message || 'Check your API key and network connection.')}`;
            }
        }
    }

    function renderState() {
        const isWaiting = state.status === 'waiting_for_user';
        const isRunning = state.status === 'running' || state.status === 'starting';
        const isOffline = state.status === 'offline';

        statusDot.className = 'dot ' + (isOffline ? 'offline' : (isWaiting ? 'waiting' : (isRunning ? 'starting' : 'online')));
        statusText.innerText = isOffline ? 'Offline' : (isWaiting ? 'Waiting for User' : (isRunning ? 'Active' : 'Connected'));

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
            agentHtml += `<div class="subagents-panel" style="margin-top: 10px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px;">`;
            agentHtml += `<div style="font-size: 11px; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">🤖 Supervised Workers · ${state.subagents.length}</div>`;
            state.subagents.forEach(sub => {
                const statusColor = sub.status === 'COMPLETED' ? 'var(--comu-success)' : sub.status === 'RUNNING' ? 'var(--comu-warning)' : 'var(--comu-error)';
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
            agentHtml += `<div style="margin-top: 6px; font-size: 12px;"><strong>Proposed Message:</strong> <input type="text" id="git-commit-msg-input" value="${escapeHtml(state.gitCommitProposal.message)}" style="width: 100%; margin-top: 4px; padding: 4px 6px; background: var(--input-bg); border: 1px solid var(--border-color); color: var(--fg-color); border-radius: 4px;" /></div>`;
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
        errorDiv.className = 'comu-error-banner';
        errorDiv.innerHTML = `⚠️ <span>${escapeHtml(msg)}</span>`;
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

    // Initial requests
    vscode.postMessage({ type: 'request_providers' });
    vscode.postMessage({ type: 'ready' });

    // In Live Preview (outside VS Code Extension Host), populate preview data
    if (isLivePreview) {
        state.providers = [
            {
                providerId: 'nvidia',
                displayName: 'NVIDIA',
                description: 'NVIDIA Nemotron high-performance engineering models. Bring your own NVIDIA API key.',
                defaultEndpoint: 'https://integrate.api.nvidia.com/v1',
                selectedModel: 'Nemotron 3 Ultra',
                hasCredential: false,
                isLocal: false,
                status: 'NOT_CONFIGURED',
                models: [{ id: 'nvidia-nemotron-3-ultra', name: 'Nemotron 3 Ultra' }]
            },
            {
                providerId: 'ollama',
                displayName: 'Ollama (Local)',
                description: 'Run open-weights models locally on your machine with zero external network access.',
                defaultEndpoint: 'http://localhost:11434',
                selectedModel: 'Llama 3 (Local)',
                hasCredential: true,
                isLocal: true,
                status: 'CONNECTED',
                models: [{ id: 'ollama-llama-3', name: 'Llama 3 (Local)' }]
            }
        ];
        renderProviders();
        renderModels();
        updateOnboardingState();
    }

})();
