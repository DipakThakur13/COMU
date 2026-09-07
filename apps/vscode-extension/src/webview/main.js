// @ts-check
(function () {
    // ═══════════════════════════════════════════════════════════
    // 1. TIMING INSTRUMENTATION & DIAGNOSTIC LOGGING (Phase 1)
    // ═══════════════════════════════════════════════════════════
    const tStartup = (typeof window !== 'undefined' && window.performance && window.performance.timing)
        ? window.performance.timing.navigationStart
        : performance.now();
    const t3 = performance.now();

    function logDiag(category, msg, data) {
        const elapsed = (performance.now() - tStartup).toFixed(1);
        console.log(`${category} [${elapsed}ms] ${msg}`, data !== undefined ? data : '');
    }

    logDiag('[COMU STARTUP]', 'T3: main.js loaded');

    // DOMContentLoaded measurement (T2)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            const t2 = performance.now();
            logDiag('[COMU WEBVIEW]', `T2: DOMContentLoaded in ${(t2 - tStartup).toFixed(1)}ms`);
        });
    } else {
        const t2 = performance.now();
        logDiag('[COMU WEBVIEW]', `T2: DOMContentLoaded already complete (${(t2 - tStartup).toFixed(1)}ms)`);
    }

    // ═══════════════════════════════════════════════════════════
    // 2. VS CODE API INITIALIZATION & SAFE SHIMS
    // ═══════════════════════════════════════════════════════════
    // @ts-ignore
    const vscode = (typeof acquireVsCodeApi === 'function')
        ? acquireVsCodeApi()
        : { postMessage: (msg) => console.log('[COMU Live Preview postMessage]:', msg) };

    const isLivePreview = typeof acquireVsCodeApi !== 'function';

    function postTelemetry(name, value, details) {
        try {
            vscode.postMessage({ type: 'telemetry_metric', name, value: Math.round(value), details });
        } catch {}
    }

    // Default static fallback models to eliminate loading delays
    const DEFAULT_STATIC_PROVIDERS = [
        {
            providerId: 'nvidia',
            displayName: 'NVIDIA Nemotron',
            description: 'NVIDIA Nemotron high-performance engineering models.',
            defaultEndpoint: 'https://integrate.api.nvidia.com/v1',
            hasCredential: true,
            isLocal: false,
            status: 'CONNECTED',
            models: [
                { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', name: 'Nemotron 3.5 Lightning 30B-A3B' },
                { id: 'deepseek-ai/deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro 0813' },
                { id: 'deepseek-ai/deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731' },
                { id: 'moonshotai/kimi-k3', name: 'Kimi K3' },
                { id: 'poolside/laguna-xs-2.1', name: 'Laguna XS 2.1' },
                { id: 'meta/muse-glimmer-30b', name: 'Muse Glimmer 30B' }
            ]
        },
        {
            providerId: 'experiential',
            displayName: 'GPT-6 Astra (Experiential Labs)',
            description: 'Frontier reasoning and coding model with 1.05M context window.',
            defaultEndpoint: 'https://api.experiential.com/v1',
            hasCredential: false,
            isLocal: false,
            status: 'NOT_CONFIGURED',
            models: [
                { id: 'gpt-6-astra', name: 'GPT-6 Astra' }
            ]
        },
        {
            providerId: 'openai',
            displayName: 'OpenAI-Compatible',
            description: 'Connect any OpenAI-compatible API endpoint.',
            defaultEndpoint: 'https://api.openai.com/v1',
            hasCredential: false,
            isLocal: false,
            status: 'NOT_CONFIGURED',
            models: [
                { id: 'gpt-4o', name: 'GPT-4o' }
            ]
        },
        {
            providerId: 'ollama',
            displayName: 'Ollama (Local)',
            description: 'Local open-weights models with zero external network access.',
            defaultEndpoint: 'http://localhost:11434',
            hasCredential: true,
            isLocal: true,
            status: 'CONNECTED',
            models: [
                { id: 'ollama-llama-3', name: 'Llama 3 (Local)' }
            ]
        }
    ];

    // ═══════════════════════════════════════════════════════════
    // 3. CENTRAL VIEW STATE (Phase 2)
    // ═══════════════════════════════════════════════════════════
    const state = {
        taskId: null,
        prompt: null,
        interactionMode: 'CHAT', // CHAT, ASK, PLAN, AGENT, AMBIGUOUS
        agentState: 'IDLE',      // IDLE, STARTING, CLASSIFYING, ANALYZING, PLANNING, THINKING, TOOL_CALLING, OBSERVING, VERIFYING, DIAGNOSING, REPAIRING, WAITING_FOR_USER, COMPLETED, FAILED, CANCELLED, LIMIT_REACHED
        status: 'idle',          // idle, running, cancelling, waiting_for_user, completed, failed, cancelled, offline
        selectedModelId: 'nvidia/nemotron-3.5-lightning-30b-a3b',
        requestedMode: 'AUTO',   // AUTO, CHAT, ASK, PLAN, AGENT
        activeNavTab: 'activity',// activity, overview, plan, changes, verification, memory, workers
        events: [],
        rawEvents: [],
        activity: [],
        fullActivity: [],
        hasOlderActivity: false,
        olderActivityCount: 0,
        showAllActivity: false,
        changes: [],
        plan: null,
        verification: null,
        diagnosis: null,
        repairAttempts: [],
        workingSet: {
            activeFile: null,
            openFiles: [],
            recentlyInspectedFiles: [],
            searchResults: [],
            diagnostics: [],
            modifiedFiles: []
        },
        memory: [],
        workers: [],
        providers: DEFAULT_STATIC_PROVIDERS,
        pendingInteraction: null,
        gitCommitProposal: null,
        gitPushProposal: null,
        finalResponse: null,
        startTime: null,
        completedTime: null,
        durationMs: null,
        estimatedTokens: 0,
        cancellation: {
            requested: false,
            acknowledged: false,
            error: null
        },
        contextDrawerOpen: false
    };

    const t4 = performance.now();
    logDiag('[COMU STATE]', `T4: frontend state initialized in ${(t4 - tStartup).toFixed(1)}ms`);

    const normalizedEventsCache = new Map();
    let sessionUpdateThrottleTimer = null;
    let pendingSessionState = null;
    let durationTimerInterval = null;
    let userScrolledUp = false;

    // ═══════════════════════════════════════════════════════════
    // 3. DOM ELEMENTS
    // ═══════════════════════════════════════════════════════════
    const appShell = document.getElementById('app-shell');
    const settingsView = document.getElementById('settings-view');

    // Header elements
    const statusDot = document.getElementById('runtime-status-dot');
    const statusLabel = document.getElementById('header-status-label');
    const headerTaskSummary = document.getElementById('header-task-summary');
    const headerStatePill = document.getElementById('header-state-pill');
    const headerTaskText = document.getElementById('header-task-text');
    const headerModelName = document.getElementById('header-model-name');
    const btnToggleContext = document.getElementById('btn-toggle-context');
    const contextBadge = document.getElementById('context-badge');
    const settingsBtn = document.getElementById('settings-btn');
    const backBtn = document.getElementById('back-btn');

    // Navigation tab buttons
    const navTabs = document.querySelectorAll('.nav-tab');
    const badgeActivity = document.getElementById('badge-activity');
    const badgePlan = document.getElementById('badge-plan');
    const badgeChanges = document.getElementById('badge-changes');
    const badgeVerification = document.getElementById('badge-verification');
    const badgeMemory = document.getElementById('badge-memory');
    const badgeWorkers = document.getElementById('badge-workers');

    // Views
    const tabViews = {
        activity: document.getElementById('view-activity'),
        overview: document.getElementById('view-overview'),
        plan: document.getElementById('view-plan'),
        changes: document.getElementById('view-changes'),
        verification: document.getElementById('view-verification'),
        memory: document.getElementById('view-memory'),
        workers: document.getElementById('view-workers')
    };

    // Activity Timeline elements
    const activityContainer = document.getElementById('activity-container');
    const emptyStateView = document.getElementById('empty-state-view');
    const timelineList = document.getElementById('timeline-list');
    const btnScrollBottom = document.getElementById('btn-scroll-bottom');

    // Context Drawer elements
    const contextDrawer = document.getElementById('context-drawer');
    const btnCloseDrawer = document.getElementById('btn-close-drawer');
    const contextActiveFile = document.getElementById('context-active-file');
    const contextInspectedList = document.getElementById('context-inspected-list');
    const contextModifiedList = document.getElementById('context-modified-list');
    const contextDiagList = document.getElementById('context-diag-list');
    const countInspected = document.getElementById('count-inspected');
    const countModified = document.getElementById('count-modified');
    const countDiag = document.getElementById('count-diag');

    // Overview Elements
    const overviewTaskTitle = document.getElementById('overview-task-title');
    const ovStatus = document.getElementById('ov-status');
    const ovMode = document.getElementById('ov-mode');
    const ovPlan = document.getElementById('ov-plan');
    const ovChanges = document.getElementById('ov-changes');
    const ovVerification = document.getElementById('ov-verification');
    const ovDuration = document.getElementById('ov-duration');
    const completionBanner = document.getElementById('completion-banner');
    const completionSummaryText = document.getElementById('completion-summary-text');
    const failureBanner = document.getElementById('failure-banner');
    const failureTitle = document.getElementById('failure-title');
    const failureDesc = document.getElementById('failure-desc');

    // Composer elements
    const promptInput = document.getElementById('prompt-input');
    const submitBtn = document.getElementById('submit-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const modeSelect = document.getElementById('mode-select');
    const modelSelect = document.getElementById('model-select');
    const configureModelBtn = document.getElementById('configure-model-btn');
    const attachmentBar = document.getElementById('composer-attachment-bar');
    const activeFileChip = document.getElementById('active-file-chip');

    // Onboarding buttons
    const btnOnboardingNvidia = document.getElementById('btn-onboarding-nvidia');
    const btnOnboardingOther = document.getElementById('btn-onboarding-other');
    const btnOnboardingLocal = document.getElementById('btn-onboarding-local');
    const providersContainer = document.getElementById('providers-container');

    // ═══════════════════════════════════════════════════════════
    // 4. EVENT LISTENERS
    // ═══════════════════════════════════════════════════════════

    // Tab selection
    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.getAttribute('data-tab');
            if (targetTab) selectNavTab(targetTab);
        });
    });

    // Composer inputs
    submitBtn.addEventListener('click', submitPrompt);
    cancelBtn.addEventListener('click', cancelTask);

    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitPrompt();
        } else if (e.key === 'Escape') {
            if (state.status === 'running' || state.status === 'waiting_for_user') {
                cancelTask();
            }
        }
    });

    // Auto-expand textarea
    promptInput.addEventListener('input', () => {
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 180) + 'px';
    });

    // Mode and Model selection
    // @ts-ignore
    modeSelect.addEventListener('change', (e) => {
        // @ts-ignore
        state.requestedMode = e.target.value;
    });

    // @ts-ignore
    modelSelect.addEventListener('change', (e) => {
        // @ts-ignore
        state.selectedModelId = e.target.value;
        vscode.postMessage({ type: 'select_model', modelId: state.selectedModelId });
        updateHeaderModelBadge();
    });

    // Context drawer toggle
    btnToggleContext.addEventListener('click', () => toggleContextDrawer());
    if (btnCloseDrawer) {
        btnCloseDrawer.addEventListener('click', () => toggleContextDrawer(false));
    }

    // Settings Navigation
    settingsBtn.addEventListener('click', () => openSettingsView());
    if (configureModelBtn) {
        configureModelBtn.addEventListener('click', () => openSettingsView());
    }
    backBtn.addEventListener('click', () => closeSettingsView());

    // Onboarding buttons
    if (btnOnboardingNvidia) {
        btnOnboardingNvidia.addEventListener('click', () => openSettingsView('nvidia'));
    }
    if (btnOnboardingOther) {
        btnOnboardingOther.addEventListener('click', () => openSettingsView());
    }
    if (btnOnboardingLocal) {
        btnOnboardingLocal.addEventListener('click', () => openSettingsView('ollama'));
    }

    // Suggested Workflow Chips
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            promptInput.value = chip.getAttribute('data-prompt') || '';
            promptInput.focus();
            promptInput.dispatchEvent(new Event('input'));
        });
    });

    // Activity Auto-scroll tracking
    activityContainer.addEventListener('scroll', () => {
        const threshold = 60;
        const isNearBottom = activityContainer.scrollHeight - activityContainer.scrollTop - activityContainer.clientHeight < threshold;
        userScrolledUp = !isNearBottom;
        btnScrollBottom.style.display = userScrolledUp && state.status === 'running' ? 'block' : 'none';
    });

    btnScrollBottom.addEventListener('click', () => {
        activityContainer.scrollTop = activityContainer.scrollHeight;
        userScrolledUp = false;
        btnScrollBottom.style.display = 'none';
    });

    // Overview buttons
    const btnOvReviewChanges = document.getElementById('btn-overview-review-changes');
    if (btnOvReviewChanges) {
        btnOvReviewChanges.addEventListener('click', () => selectNavTab('changes'));
    }
    const btnOvOpenFiles = document.getElementById('btn-overview-open-files');
    if (btnOvOpenFiles) {
        btnOvOpenFiles.addEventListener('click', () => {
            if (state.changes && state.changes.length > 0) {
                vscode.postMessage({ type: 'open_file', path: state.changes[0].path });
            }
        });
    }

    // Extension Message Dispatcher
    window.addEventListener('message', event => {
        const message = event.data;
        if (!message) return;

        switch (message.type) {
            case 'state_update': {
                const t12 = performance.now();
                logDiag('[COMU STATE]', `T12: session hydration received (${(t12 - tStartup).toFixed(1)}ms)`);
                handleSessionStateUpdate(message.state);
                break;
            }
            case 'providers_update': {
                const t13 = performance.now();
                logDiag('[COMU STARTUP]', `T13: provider/model metadata loaded (${(t13 - tStartup).toFixed(1)}ms)`);
                state.providers = message.providers || [];
                renderProviders();
                renderModels();
                break;
            }
            case 'provider_test_result':
                handleProviderTestResult(message.providerId, message.result);
                break;
            case 'open_settings':
                openSettingsView(message.targetProviderId);
                break;
            case 'error':
                appendActivityError(message.message);
                break;
        }
    });

    // ═══════════════════════════════════════════════════════════
    // 5. NAVIGATION & TAB SWITCHING
    // ═══════════════════════════════════════════════════════════
    function selectNavTab(tabName) {
        state.activeNavTab = tabName;

        navTabs.forEach(t => {
            const isTarget = t.getAttribute('data-tab') === tabName;
            t.classList.toggle('active', isTarget);
            t.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        });

        Object.keys(tabViews).forEach(k => {
            if (tabViews[k]) {
                tabViews[k].style.display = k === tabName ? 'flex' : 'none';
            }
        });

        // Progressive on-demand hydration of specific tab content
        if (tabName === 'overview') safeRenderSection('overview', renderOverview);
        else if (tabName === 'plan') safeRenderSection('plan', renderPlan);
        else if (tabName === 'changes') safeRenderSection('changes', renderChanges);
        else if (tabName === 'verification') safeRenderSection('verification', renderVerification);
        else if (tabName === 'memory') safeRenderSection('memory', renderMemory);
        else if (tabName === 'workers') safeRenderSection('workers', renderWorkers);
        else if (tabName === 'activity' && !userScrolledUp) {
            activityContainer.scrollTop = activityContainer.scrollHeight;
        }
    }

    function toggleContextDrawer(forceState) {
        const nextState = forceState !== undefined ? forceState : !state.contextDrawerOpen;
        state.contextDrawerOpen = nextState;
        contextDrawer.classList.toggle('open', nextState);
    }

    function openSettingsView(targetProviderId) {
        appShell.style.display = 'none';
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
        appShell.style.display = 'flex';
    }

    // ═══════════════════════════════════════════════════════════
    // 6. COMPOSER ACTIONS & CANCELLATION (Phase 6, 16, 20)
    // ═══════════════════════════════════════════════════════════
    function submitPrompt() {
        const text = promptInput.value.trim();
        if (!text || state.status === 'running' || state.status === 'cancelling') return;

        if (!state.selectedModelId) {
            appendActivityError("No AI model configured. Please configure an AI provider in Settings.");
            openSettingsView();
            return;
        }

        // Send typed WebviewMessage to extension host
        vscode.postMessage({
            type: 'submit_prompt',
            prompt: text,
            modelId: state.selectedModelId,
            mode: state.requestedMode
        });

        promptInput.value = '';
        promptInput.style.height = 'auto';

        // Auto-switch to Activity view on task start
        selectNavTab('activity');
    }

    function cancelTask() {
        if (state.status === 'running' || state.status === 'waiting_for_user') {
            // Immediate UI feedback (Phase 16)
            state.status = 'cancelling';
            state.cancellation.requested = true;
            renderCancellationStatus();
            vscode.postMessage({ type: 'cancel_task' });
        }
    }

    function renderCancellationStatus() {
        if (state.status === 'cancelling') {
            cancelBtn.innerText = '◌ Cancelling…';
            cancelBtn.disabled = true;
            statusDot.className = 'dot waiting';
            statusLabel.innerText = 'Cancelling…';
        } else if (state.status === 'cancelled') {
            cancelBtn.innerText = '✕ Cancelled';
            cancelBtn.disabled = true;
            statusDot.className = 'dot offline';
            statusLabel.innerText = 'Cancelled';
        } else if (state.status === 'running' || state.status === 'waiting_for_user') {
            cancelBtn.innerText = '■ Stop';
            cancelBtn.disabled = false;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 7. EVENT NORMALIZATION & GROUPING (Phase 2, 6, 12)
    // ═══════════════════════════════════════════════════════════
    function normalizeRawEvent(event) {
        if (!event || !event.type) return null;
        const id = `${event.taskId || 'task'}-${event.eventId || Date.now()}-${event.type}`;
        const timestamp = event.timestamp || new Date().toISOString();

        switch (event.type) {
            case 'task.started':
                return {
                    id,
                    category: 'SYSTEM_EVENT',
                    status: 'completed',
                    title: 'Task started',
                    shortDescription: 'Initialized execution context',
                    timestamp
                };

            case 'agent.status': {
                const st = (event.status || '').toUpperCase();
                let status = 'active';
                if (st === 'COMPLETED') status = 'completed';
                else if (st === 'FAILED' || st.includes('ERROR')) status = 'failed';
                else if (st === 'CANCELLED') status = 'warning';

                let toolCat = 'Generic';
                if (st.includes('READ')) toolCat = 'Read';
                else if (st.includes('SEARCH')) toolCat = 'Search';
                else if (st.includes('EDIT')) toolCat = 'Edit';
                else if (st.includes('VERIF')) toolCat = 'Verification';
                else if (st.includes('DIAG')) toolCat = 'Diagnosis';
                else if (st.includes('REPAIR')) toolCat = 'Repair';

                return {
                    id,
                    category: 'SYSTEM_EVENT',
                    toolCategory: toolCat,
                    status,
                    title: event.status,
                    timestamp
                };
            }

            case 'tool.started': {
                const toolName = event.tool || 'tool';
                const toolCat = categorizeTool(toolName);
                const target = event.path || event.filePath || event.command || event.pattern || '';
                return {
                    id,
                    category: 'TOOL_ACTIVITY',
                    toolCategory: toolCat,
                    status: 'active',
                    title: `${toolCat}: ${formatFilePath(target, toolName)}`,
                    shortDescription: target || toolName,
                    timestamp,
                    details: { tool: toolName, ...event }
                };
            }

            case 'tool.completed': {
                const toolName = event.tool || 'tool';
                const toolCat = categorizeTool(toolName);
                const target = event.path || event.filePath || (event.result && (event.result.path || event.result.target)) || '';
                return {
                    id,
                    category: 'TOOL_ACTIVITY',
                    toolCategory: toolCat,
                    status: 'completed',
                    title: `${toolCat}: ${formatFilePath(target, toolName)}`,
                    shortDescription: (event.result && event.result.summary) || target || 'Done',
                    timestamp,
                    details: { tool: toolName, result: event.result }
                };
            }

            case 'change.created':
                return {
                    id,
                    category: 'TOOL_ACTIVITY',
                    toolCategory: event.operation === 'CREATE' ? 'Create' : 'Edit',
                    status: 'completed',
                    title: `${event.operation === 'CREATE' ? 'Created' : 'Modified'} ${formatFilePath(event.path, '')}`,
                    shortDescription: event.path,
                    timestamp,
                    details: { path: event.path, operation: event.operation }
                };

            case 'plan.created':
                return {
                    id,
                    category: 'SYSTEM_EVENT',
                    status: 'completed',
                    title: `Implementation Plan created (v${event.planVersion || 1})`,
                    shortDescription: `${event.plan?.steps?.length || 0} steps`,
                    timestamp,
                    details: { plan: event.plan }
                };

            case 'plan.step.started':
                return {
                    id,
                    category: 'SYSTEM_EVENT',
                    status: 'active',
                    title: `Step started: ${event.stepId}`,
                    timestamp
                };

            case 'plan.step.completed':
                return {
                    id,
                    category: 'SYSTEM_EVENT',
                    status: 'completed',
                    title: `Step completed: ${event.stepId}`,
                    shortDescription: event.resultSummary,
                    timestamp
                };

            case 'plan.step.failed':
                return {
                    id,
                    category: 'SYSTEM_EVENT',
                    status: 'failed',
                    title: `Step failed: ${event.stepId}`,
                    shortDescription: event.error,
                    timestamp
                };

            case 'verification.started':
                return {
                    id,
                    category: 'VALIDATION',
                    toolCategory: 'Verification',
                    status: 'active',
                    title: 'Workspace Verification started',
                    timestamp
                };

            case 'verification.completed': {
                const passed = event.result?.status === 'PASSED';
                return {
                    id,
                    category: 'VALIDATION',
                    toolCategory: 'Verification',
                    status: passed ? 'completed' : 'failed',
                    title: `Verification ${event.result?.status || 'completed'}`,
                    shortDescription: event.result?.summary,
                    timestamp,
                    durationMs: event.result?.durationMs,
                    details: { result: event.result }
                };
            }

            case 'diagnosis.created':
                return {
                    id,
                    category: 'DIAGNOSIS',
                    toolCategory: 'Diagnosis',
                    status: 'warning',
                    title: `Diagnosis: ${event.diagnosis?.failureType || 'Issue identified'}`,
                    shortDescription: event.diagnosis?.summary,
                    timestamp,
                    details: { diagnosis: event.diagnosis }
                };

            case 'repair.started':
                return {
                    id,
                    category: 'REPAIR',
                    toolCategory: 'Repair',
                    status: 'active',
                    title: `Repair attempt ${event.attemptNumber} started`,
                    timestamp,
                    details: { targetFiles: event.targetFiles }
                };

            case 'repair.completed':
                return {
                    id,
                    category: 'REPAIR',
                    toolCategory: 'Repair',
                    status: 'completed',
                    title: `Repair attempt ${event.attemptNumber} completed`,
                    shortDescription: event.outcome,
                    timestamp
                };

            case 'subagent.started':
                return {
                    id,
                    category: 'TOOL_ACTIVITY',
                    toolCategory: 'Worker',
                    status: 'active',
                    title: `${event.subagentType || 'Subagent'} worker started`,
                    shortDescription: event.goal,
                    timestamp
                };

            case 'subagent.completed':
                return {
                    id,
                    category: 'TOOL_ACTIVITY',
                    toolCategory: 'Worker',
                    status: 'completed',
                    title: `${event.subagentType || 'Subagent'} worker completed`,
                    shortDescription: event.result?.summary,
                    timestamp
                };

            case 'task.completed':
                return {
                    id,
                    category: 'SYSTEM_EVENT',
                    status: 'completed',
                    title: 'Task completed successfully',
                    timestamp
                };

            case 'task.failed':
                return {
                    id,
                    category: 'SYSTEM_EVENT',
                    status: 'failed',
                    title: `Task failed: ${event.error || 'Execution halted'}`,
                    timestamp
                };

            case 'task.cancelled':
                return {
                    id,
                    category: 'SYSTEM_EVENT',
                    status: 'warning',
                    title: 'Task cancelled by user',
                    timestamp
                };

            default:
                return null;
        }
    }

    function categorizeTool(name) {
        const l = (name || '').toLowerCase();
        if (l.includes('read')) return 'Read';
        if (l.includes('search') || l.includes('find') || l.includes('grep')) return 'Search';
        if (l.includes('edit') || l.includes('replace') || l.includes('patch')) return 'Edit';
        if (l.includes('write')) return 'Write';
        if (l.includes('create')) return 'Create';
        if (l.includes('terminal') || l.includes('exec') || l.includes('bash') || l.includes('cmd')) return 'Terminal';
        if (l.includes('git')) return 'Git';
        if (l.includes('verif') || l.includes('test') || l.includes('lint')) return 'Verification';
        if (l.includes('diag')) return 'Diagnosis';
        if (l.includes('repair')) return 'Repair';
        if (l.includes('worker') || l.includes('subagent')) return 'Worker';
        return 'Generic';
    }

    function formatFilePath(target, fallback) {
        if (!target) return fallback;
        const normalized = target.replace(/\\/g, '/');
        const parts = normalized.split('/');
        return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : normalized;
    }

    function groupEvents(items) {
        if (!items || items.length === 0) return [];
        const grouped = [];
        let currentGroup = [];
        let currentCategory = null;

        function flush() {
            if (currentGroup.length === 0) return;
            if (currentGroup.length === 1) {
                grouped.push(currentGroup[0]);
            } else {
                const first = currentGroup[0];
                const cat = currentCategory || 'Generic';
                let title = '';
                if (cat === 'Read') title = `Read ${currentGroup.length} files`;
                else if (cat === 'Search') title = `Searched repository (${currentGroup.length} queries)`;
                else title = `${cat} operations (${currentGroup.length})`;

                grouped.push({
                    id: `group-${first.id}-${currentGroup.length}`,
                    isGroup: true,
                    category: first.category,
                    toolCategory: cat,
                    status: currentGroup.some(i => i.status === 'failed') ? 'failed' :
                            currentGroup.some(i => i.status === 'active') ? 'active' : 'completed',
                    title,
                    shortDescription: `${currentGroup.length} ${cat.toLowerCase()} activities`,
                    items: [...currentGroup],
                    timestamp: currentGroup[currentGroup.length - 1].timestamp
                });
            }
            currentGroup = [];
            currentCategory = null;
        }

        for (const item of items) {
            const isGroupable = item.category === 'TOOL_ACTIVITY' && (item.toolCategory === 'Read' || item.toolCategory === 'Search');
            if (isGroupable) {
                if (currentCategory === item.toolCategory) {
                    currentGroup.push(item);
                } else {
                    flush();
                    currentCategory = item.toolCategory;
                    currentGroup.push(item);
                }
            } else {
                flush();
                grouped.push(item);
            }
        }
        flush();
        return grouped;
    }

    // ═══════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════
    // 8. STATE UPDATE REDUCER (Phase 2, 4, 5)
    // ═══════════════════════════════════════════════════════════
    function handleSessionStateUpdate(newState) {
        if (!newState) return;
        pendingSessionState = newState;

        // Throttle high-frequency event/token updates at ~40ms
        if (!sessionUpdateThrottleTimer) {
            sessionUpdateThrottleTimer = setTimeout(() => {
                sessionUpdateThrottleTimer = null;
                if (pendingSessionState) {
                    const toApply = pendingSessionState;
                    pendingSessionState = null;
                    applySessionStateUpdate(toApply);
                }
            }, 40);
        }
    }

    function applySessionStateUpdate(newState) {
        if (!newState) return;

        state.taskId = newState.taskId !== undefined ? newState.taskId : state.taskId;
        state.prompt = newState.prompt !== undefined ? newState.prompt : state.prompt;
        state.status = newState.status || state.status;
        state.selectedModelId = newState.modelId || state.selectedModelId;
        state.changes = newState.changes || [];
        state.plan = newState.plan !== undefined ? newState.plan : state.plan;
        state.verification = newState.verification !== undefined ? newState.verification : state.verification;
        state.diagnosis = newState.diagnosis !== undefined ? newState.diagnosis : state.diagnosis;
        state.repairAttempts = newState.repairAttempts || [];
        state.workingSet = newState.workingSet || state.workingSet;
        state.memory = newState.memories || state.memory;
        state.workers = newState.subagents || state.workers;
        state.pendingInteraction = newState.pendingInteraction !== undefined ? newState.pendingInteraction : state.pendingInteraction;
        state.gitCommitProposal = newState.gitCommitProposal !== undefined ? newState.gitCommitProposal : state.gitCommitProposal;
        state.gitPushProposal = newState.gitPushProposal !== undefined ? newState.gitPushProposal : state.gitPushProposal;
        state.finalResponse = newState.finalResponse !== undefined ? newState.finalResponse : state.finalResponse;
        state.startTime = newState.startTime || state.startTime;
        state.completedTime = newState.completedTime || state.completedTime;
        state.durationMs = newState.durationMs || state.durationMs;

        // Inferred or backend interaction mode
        if (newState.interactionMode) {
            state.interactionMode = newState.interactionMode;
        }

        // Incremental normalization using normalizedEventsCache
        const seenIds = new Set();
        const normalized = [];
        if (newState.events && Array.isArray(newState.events)) {
            for (const ev of newState.events) {
                const uniqueKey = ev.taskId ? `${ev.taskId}-${ev.eventId}-${ev.type}` : `${ev.eventId}-${ev.type}`;
                let norm = normalizedEventsCache.get(uniqueKey);
                if (!norm) {
                    norm = normalizeRawEvent(ev);
                    if (norm) {
                        normalizedEventsCache.set(uniqueKey, norm);
                    }
                }
                if (norm && !seenIds.has(norm.id)) {
                    seenIds.add(norm.id);
                    normalized.push(norm);
                }
            }
        }

        // Group activity items
        const grouped = groupEvents(normalized);
        state.fullActivity = grouped;

        // Bounded visible history: show latest 50 items unless user explicitly expanded
        if (!state.showAllActivity && grouped.length > 50) {
            state.activity = grouped.slice(-50);
            state.hasOlderActivity = true;
            state.olderActivityCount = grouped.length - 50;
        } else {
            state.activity = grouped;
            state.hasOlderActivity = false;
            state.olderActivityCount = 0;
        }

        // Update Cancellation State
        if (state.status === 'cancelling') {
            state.cancellation.requested = true;
        } else if (state.status === 'cancelled') {
            state.cancellation.acknowledged = true;
        }

        // Targeted render: header, badges, composer, and only the active tab
        renderHeader();
        renderNavBadges();
        renderComposerControls();

        if (state.activeNavTab === 'activity') {
            renderActivityTimeline();
        } else if (state.activeNavTab === 'overview') {
            safeRenderSection('overview', renderOverview);
        } else if (state.activeNavTab === 'plan') {
            safeRenderSection('plan', renderPlan);
        } else if (state.activeNavTab === 'changes') {
            safeRenderSection('changes', renderChanges);
        } else if (state.activeNavTab === 'verification') {
            safeRenderSection('verification', renderVerification);
        } else if (state.activeNavTab === 'memory') {
            safeRenderSection('memory', renderMemory);
        } else if (state.activeNavTab === 'workers') {
            safeRenderSection('workers', renderWorkers);
        }

        if (state.contextDrawerOpen) {
            safeRenderSection('context-drawer', renderContextDrawer);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 9. WORKSPACE RENDER ORCHESTRATION & ERROR BOUNDARIES (Phase 7)
    // ═══════════════════════════════════════════════════════════
    function safeRenderSection(sectionName, renderFn) {
        try {
            renderFn();
        } catch (err) {
            console.error(`[COMU RENDER] Error rendering ${sectionName}:`, err);
            const view = tabViews[sectionName] || document.getElementById(`view-${sectionName}`);
            if (view) {
                view.innerHTML = `<div class="component-error-boundary" style="padding:16px; opacity:0.8;"><p>⚠️ Unable to load ${sectionName} section.</p></div>`;
            }
        }
    }

    function renderWorkspace() {
        renderHeader();
        renderNavBadges();
        renderActivityTimeline();
        safeRenderSection('overview', renderOverview);
        safeRenderSection('plan', renderPlan);
        safeRenderSection('changes', renderChanges);
        safeRenderSection('verification', renderVerification);
        safeRenderSection('memory', renderMemory);
        safeRenderSection('workers', renderWorkers);
        safeRenderSection('context-drawer', renderContextDrawer);
        renderComposerControls();
    }

    // Header Rendering
    function renderHeader() {
        const isRunning = state.status === 'running';
        const isCancelling = state.status === 'cancelling';
        const isCancelled = state.status === 'cancelled';
        const isCompleted = state.status === 'completed';
        const isFailed = state.status === 'failed';
        const isWaiting = state.status === 'waiting_for_user';
        const isOffline = state.status === 'offline';

        statusDot.className = 'dot ' + (
            isOffline ? 'offline' :
            isCancelled ? 'offline' :
            isCancelling ? 'waiting' :
            isWaiting ? 'waiting' :
            isRunning ? 'online' :
            isCompleted ? 'online' :
            isFailed ? 'offline' : 'online'
        );

        statusLabel.innerText = (
            isOffline ? 'Offline' :
            isCancelled ? 'Cancelled' :
            isCancelling ? 'Cancelling…' :
            isWaiting ? 'Waiting for User' :
            isRunning ? 'Running' :
            isCompleted ? 'Completed' :
            isFailed ? 'Failed' : 'Ready'
        );

        if (state.taskId && state.prompt) {
            headerTaskSummary.style.display = 'flex';
            headerStatePill.innerText = state.interactionMode;
            headerTaskText.innerText = state.prompt;
        } else {
            headerTaskSummary.style.display = 'none';
        }

        updateHeaderModelBadge();
    }

    function updateHeaderModelBadge() {
        if (!headerModelName) return;
        let displayName = state.selectedModelId;
        for (const p of state.providers) {
            if (p.models) {
                const found = p.models.find(m => m.id === state.selectedModelId);
                if (found) {
                    displayName = found.name;
                    break;
                }
            }
        }
        headerModelName.innerText = displayName || 'Select Model';
    }

    // Navigation Badges Rendering
    function renderNavBadges() {
        // Plan badge
        if (state.plan && state.plan.steps && state.plan.steps.length > 0) {
            const completedCount = state.plan.steps.filter(s => s.status === 'COMPLETED').length;
            badgePlan.style.display = 'inline-block';
            badgePlan.innerText = `${completedCount}/${state.plan.steps.length}`;
        } else {
            badgePlan.style.display = 'none';
        }

        // Changes badge
        if (state.changes && state.changes.length > 0) {
            badgeChanges.style.display = 'inline-block';
            badgeChanges.innerText = `${state.changes.length}`;
        } else {
            badgeChanges.style.display = 'none';
        }

        // Verification badge
        if (state.verification) {
            badgeVerification.style.display = 'inline-block';
            badgeVerification.innerText = state.verification.status === 'PASSED' ? '✓' : '✕';
            badgeVerification.className = `nav-badge ${state.verification.status === 'PASSED' ? 'badge-passed' : 'badge-failed'}`;
        } else {
            badgeVerification.style.display = 'none';
        }

        // Memory badge
        if (state.memory && state.memory.length > 0) {
            badgeMemory.style.display = 'inline-block';
            badgeMemory.innerText = `${state.memory.length}`;
        } else {
            badgeMemory.style.display = 'none';
        }

        // Workers badge
        if (state.workers && state.workers.length > 0) {
            badgeWorkers.style.display = 'inline-block';
            badgeWorkers.innerText = `${state.workers.length}`;
        } else {
            badgeWorkers.style.display = 'none';
        }

        // Activity live dot
        badgeActivity.style.display = state.status === 'running' ? 'inline-block' : 'none';

        // Context badge
        const totalContextItems = (state.workingSet?.recentlyInspectedFiles?.length || 0) +
                                  (state.workingSet?.modifiedFiles?.length || 0);
        if (totalContextItems > 0) {
            contextBadge.style.display = 'inline-block';
            contextBadge.innerText = `${totalContextItems}`;
        } else {
            contextBadge.style.display = 'none';
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 10. ACTIVITY TIMELINE RENDERING (Phase 7, 11, 13)
    // ═══════════════════════════════════════════════════════════
    function renderActivityTimeline() {
        if (!state.taskId && (!state.activity || state.activity.length === 0)) {
            emptyStateView.style.display = 'flex';
            timelineList.style.display = 'none';
            return;
        }

        emptyStateView.style.display = 'none';
        timelineList.style.display = 'flex';
        timelineList.innerHTML = '';

        // 1. User prompt card
        if (state.prompt) {
            const promptCard = document.createElement('div');
            promptCard.className = 'activity-card user-prompt-card';
            promptCard.innerHTML = `
                <div class="activity-header">
                    <div class="activity-title-group">
                        <span class="tool-tag">USER</span>
                        <span class="activity-title-text">${escapeHtml(state.prompt)}</span>
                    </div>
                </div>
            `;
            timelineList.appendChild(promptCard);
        }

        // 2. Interactive Approval / Input Card if pending
        if (state.pendingInteraction) {
            const pi = state.pendingInteraction;
            const card = document.createElement('div');
            card.className = 'interaction-card';
            let html = `
                <div class="interaction-header">
                    <span>${pi.type === 'APPROVAL' ? '🛡️ APPROVAL REQUIRED' : '💬 INPUT REQUIRED'}</span>
                </div>
                <div class="interaction-title">${escapeHtml(pi.title)}</div>
                <div class="interaction-message">${escapeHtml(pi.message)}</div>
            `;
            if (pi.type === 'INPUT' && pi.options && pi.options.length > 0) {
                html += `<div class="interaction-options">`;
                pi.options.forEach((opt, idx) => {
                    const checked = idx === 0 ? 'checked' : '';
                    html += `<label class="interaction-option"><input type="radio" name="opt_choice" value="${escapeHtml(opt)}" ${checked}> <span>${escapeHtml(opt)}</span></label>`;
                });
                html += `</div><div class="interaction-actions"><button id="btn-submit-choice" class="primary">Submit</button></div>`;
            } else if (pi.type === 'APPROVAL') {
                html += `<div class="interaction-actions">
                    <button id="btn-approve" class="primary">✓ Approve</button>
                    <button id="btn-deny" class="danger">✕ Deny</button>
                </div>`;
            }
            card.innerHTML = html;
            timelineList.appendChild(card);
        }

        // Show banner for older collapsed activities if history was bounded
        if (state.hasOlderActivity) {
            const olderBanner = document.createElement('div');
            olderBanner.className = 'older-activity-banner';
            olderBanner.innerHTML = `<button class="btn-show-earlier-activity">↑ Show ${state.olderActivityCount} earlier activities</button>`;
            timelineList.appendChild(olderBanner);
        }

        // 3. Render Timeline Items & Groups
        state.activity.forEach(entry => {
            const card = document.createElement('div');
            card.className = 'activity-card';
            card.setAttribute('data-card-id', entry.id);

            const statusIcon = getStatusIcon(entry.status);
            const toolTagClass = entry.toolCategory ? `tool-tag-${entry.toolCategory.toLowerCase()}` : '';

            let detailsHtml = '';
            if (entry.isGroup && entry.items) {
                detailsHtml = `
                    <div class="activity-details-panel" style="display: none;">
                        ${entry.items.map(sub => `
                            <div class="activity-details-row">
                                <span>${escapeHtml(sub.title)}</span>
                                <span class="activity-meta">${formatTimestamp(sub.timestamp)}</span>
                            </div>
                        `).join('')}
                    </div>
                `;
            } else if (entry.details) {
                detailsHtml = `
                    <div class="activity-details-panel" style="display: none;">
                        <pre class="inline-code">${escapeHtml(JSON.stringify(entry.details, null, 2))}</pre>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="activity-header">
                    <div class="activity-title-group">
                        <span class="activity-status-icon status-icon-${entry.status}">${statusIcon}</span>
                        ${entry.toolCategory ? `<span class="tool-tag ${toolTagClass}">${escapeHtml(entry.toolCategory)}</span>` : ''}
                        <span class="activity-title-text">${escapeHtml(entry.title)}</span>
                    </div>
                    <div class="activity-meta">
                        <span>${formatTimestamp(entry.timestamp)}</span>
                        ${(entry.isGroup || entry.details) ? `<span class="activity-chevron">▸</span>` : ''}
                    </div>
                </div>
                ${detailsHtml}
            `;

            timelineList.appendChild(card);
        });

        // 4. Final Response Card (if any)
        if (state.finalResponse) {
            const finalCard = document.createElement('div');
            finalCard.className = 'activity-card final-response-card';
            finalCard.innerHTML = `
                <div class="activity-header">
                    <div class="activity-title-group">
                        <span class="activity-status-icon status-icon-completed">✓</span>
                        <span class="tool-tag tool-tag-verification">RESULT</span>
                        <span class="activity-title-text">COMU Solution</span>
                    </div>
                </div>
                <div class="final-response-body" style="padding-top: var(--space-2); font-size: var(--text-sm); line-height: 1.5;">
                    ${renderRichText(state.finalResponse)}
                </div>
            `;
            timelineList.appendChild(finalCard);
        }

        // Auto-scroll if user has not scrolled up
        if (!userScrolledUp) {
            activityContainer.scrollTop = activityContainer.scrollHeight;
        }
    }

    function getStatusIcon(status) {
        switch (status) {
            case 'completed': return '✓';
            case 'active': return '◉';
            case 'warning': return '⚠';
            case 'failed': return '✕';
            default: return '○';
        }
    }

    function formatTimestamp(isoStr) {
        if (!isoStr) return '';
        try {
            const d = new Date(isoStr);
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch {
            return '';
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 11. OVERVIEW PANEL RENDERING (Phase 8, 35, 36)
    // ═══════════════════════════════════════════════════════════
    function renderOverview() {
        overviewTaskTitle.innerText = state.prompt || 'No active task';
        ovStatus.innerText = state.status.toUpperCase();
        ovMode.innerText = state.interactionMode;

        // Plan count
        if (state.plan?.steps) {
            const done = state.plan.steps.filter(s => s.status === 'COMPLETED').length;
            ovPlan.innerText = `${done} / ${state.plan.steps.length}`;
        } else {
            ovPlan.innerText = '—';
        }

        // Changes
        ovChanges.innerText = `${state.changes?.length || 0} files`;

        // Verification
        if (state.verification) {
            const pass = state.verification.checks?.filter(c => c.status === 'PASSED').length || 0;
            const total = state.verification.checks?.length || 0;
            ovVerification.innerText = `${pass} / ${total} (${state.verification.status})`;
        } else {
            ovVerification.innerText = '—';
        }

        // Duration timer
        renderDuration();

        // Completion Banner
        if (state.status === 'completed') {
            completionBanner.style.display = 'flex';
            completionSummaryText.innerText = `${state.changes?.length || 0} files changed. All automated verification checks passed.`;
        } else {
            completionBanner.style.display = 'none';
        }

        // Failure Banner
        if (state.status === 'failed') {
            failureBanner.style.display = 'flex';
            failureTitle.innerText = state.diagnosis?.failureType ? `TASK FAILED: ${state.diagnosis.failureType}` : 'TASK FAILED';
            failureDesc.innerText = state.diagnosis?.summary || 'The task failed during execution. Check Verification and Activity for details.';
        } else {
            failureBanner.style.display = 'none';
        }
    }

    function renderDuration() {
        if (!state.startTime) {
            ovDuration.innerText = '00:00';
            return;
        }
        const end = state.completedTime || Date.now();
        const diffSec = Math.max(0, Math.floor((end - state.startTime) / 1000));
        const mins = String(Math.floor(diffSec / 60)).padStart(2, '0');
        const secs = String(diffSec % 60).padStart(2, '0');
        ovDuration.innerText = `${mins}:${secs}`;
    }

    // ═══════════════════════════════════════════════════════════
    // 12. PLAN, CHANGES, VERIFICATION, MEMORY, WORKERS (Phases 9-13)
    // ═══════════════════════════════════════════════════════════
    function renderPlan() {
        const list = document.getElementById('plan-steps-list');
        const statusBadge = document.getElementById('plan-status-badge');
        const versionBadge = document.getElementById('plan-version-badge');
        if (!list) return;

        if (!state.plan || !state.plan.steps || state.plan.steps.length === 0) {
            list.innerHTML = '<div class="empty-panel-text">No active engineering plan.</div>';
            return;
        }

        statusBadge.innerText = state.plan.status || 'READY';
        statusBadge.className = `status-badge badge-${(state.plan.status || '').toLowerCase()}`;
        versionBadge.innerText = `v${state.plan.version || 1}`;

        list.innerHTML = '';
        state.plan.steps.forEach((step, idx) => {
            const card = document.createElement('div');
            card.className = 'plan-step';
            const icon = step.status === 'COMPLETED' ? '✓' :
                         step.status === 'RUNNING' ? '●' :
                         step.status === 'FAILED' ? '✕' : '○';

            card.innerHTML = `
                <div class="step-icon step-${(step.status || '').toLowerCase()}">${icon}</div>
                <div class="step-info" style="flex-grow: 1;">
                    <div class="step-title" style="font-weight: 600; font-size: var(--text-sm);">${idx + 1}. ${escapeHtml(step.title)}</div>
                    ${step.resultSummary ? `<div class="step-summary" style="font-size: var(--text-xs); opacity: 0.6; margin-top: 2px;">${escapeHtml(step.resultSummary)}</div>` : ''}
                </div>
            `;
            list.appendChild(card);
        });
    }

    function renderChanges() {
        const list = document.getElementById('changes-list');
        const badge = document.getElementById('changes-count-badge');
        if (!list) return;

        if (!state.changes || state.changes.length === 0) {
            list.innerHTML = '<div class="empty-panel-text">No files modified in this task yet.</div>';
            if (badge) badge.innerText = '0 files';
            return;
        }

        if (badge) badge.innerText = `${state.changes.length} files`;
        list.innerHTML = '';

        state.changes.forEach(c => {
            const row = document.createElement('div');
            row.className = 'change-item';
            const opTag = c.operation === 'CREATE' ? 'A' : 'M';

            row.innerHTML = `
                <div style="display: flex; align-items: center; gap: var(--space-2);">
                    <span class="change-op op-${c.operation}">${opTag}</span>
                    <span style="font-family: var(--font-mono); font-size: var(--text-xs);">${escapeHtml(c.path)}</span>
                </div>
                <button class="byok-action-btn secondary" style="padding: 2px var(--space-2); font-size: 10px;">Diff →</button>
            `;

            row.addEventListener('click', () => {
                vscode.postMessage({ type: 'request_diff', path: c.path });
            });

            list.appendChild(row);
        });
    }

    function renderVerification() {
        const list = document.getElementById('verif-checks-list');
        const gateBadge = document.getElementById('verif-gate-badge');
        const diagCard = document.getElementById('verif-diagnostics-card');
        const repairCard = document.getElementById('verif-repair-card');
        if (!list) return;

        if (!state.verification) {
            list.innerHTML = '<div class="empty-panel-text">No verification runs recorded yet.</div>';
            if (gateBadge) gateBadge.innerText = 'PENDING';
            return;
        }

        if (gateBadge) {
            gateBadge.innerText = state.verification.status;
            gateBadge.className = `status-badge badge-${state.verification.status.toLowerCase()}`;
        }

        list.innerHTML = '';
        if (state.verification.checks) {
            state.verification.checks.forEach(check => {
                const item = document.createElement('div');
                item.className = `check-item check-${check.status.toLowerCase()}`;
                const icon = check.status === 'PASSED' ? '✓' : check.status === 'FAILED' ? '✕' : '↷';

                item.innerHTML = `
                    <div style="display: flex; align-items: center; gap: var(--space-2);">
                        <span>${icon}</span>
                        <strong>${escapeHtml(check.name)}</strong>
                        <span class="badge-pill">${check.required ? 'REQ' : 'OPT'}</span>
                    </div>
                    <span style="font-size: var(--text-xs); opacity: 0.5;">${escapeHtml(check.skipReason || check.details || check.status)}</span>
                `;
                list.appendChild(item);
            });
        }

        // Failure Diagnosis
        if (state.diagnosis && diagCard) {
            diagCard.style.display = 'block';
            diagCard.innerHTML = `
                <div class="overview-section-header">FAILURE DIAGNOSIS</div>
                <div style="font-weight: 700; color: var(--comu-error); margin-top: 4px;">${escapeHtml(state.diagnosis.failureType)}</div>
                <div style="font-size: var(--text-sm); opacity: 0.8; margin-top: 2px;">${escapeHtml(state.diagnosis.summary)}</div>
            `;
        } else if (diagCard) {
            diagCard.style.display = 'none';
        }

        // Repair Attempts
        if (state.repairAttempts && state.repairAttempts.length > 0 && repairCard) {
            repairCard.style.display = 'block';
            repairCard.innerHTML = `
                <div class="overview-section-header">REPAIR ATTEMPTS (${state.repairAttempts.length})</div>
                ${state.repairAttempts.map(r => `
                    <div style="display: flex; justify-content: space-between; font-size: var(--text-xs); padding: 4px 0;">
                        <span>Attempt ${r.attemptNumber}: ${escapeHtml(r.changeSummary || 'Applied fix')}</span>
                        <span class="status-badge badge-${r.validationStatus.toLowerCase()}">${r.validationStatus}</span>
                    </div>
                `).join('')}
            `;
        } else if (repairCard) {
            repairCard.style.display = 'none';
        }
    }

    function renderMemory() {
        const list = document.getElementById('memory-list');
        const badge = document.getElementById('memory-count-badge');
        if (!list) return;

        if (!state.memory || state.memory.length === 0) {
            list.innerHTML = '<div class="empty-panel-text">No workspace conventions or memories recorded.</div>';
            if (badge) badge.innerText = '0 verified';
            return;
        }

        if (badge) badge.innerText = `${state.memory.length} verified`;
        list.innerHTML = '';

        state.memory.forEach(m => {
            const card = document.createElement('div');
            card.className = 'activity-card';
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span class="tool-tag tool-tag-verification">${escapeHtml(m.type || 'CONVENTION')}</span>
                    <span class="status-badge badge-passed">${escapeHtml(m.trustLevel || 'VERIFIED')}</span>
                </div>
                <div style="font-size: var(--text-sm); font-weight: 600; margin-top: var(--space-1);">${escapeHtml(m.content)}</div>
            `;
            list.appendChild(card);
        });
    }

    function renderWorkers() {
        const list = document.getElementById('workers-list');
        const badge = document.getElementById('workers-count-badge');
        if (!list) return;

        if (!state.workers || state.workers.length === 0) {
            list.innerHTML = '<div class="empty-panel-text">No background worker agents deployed.</div>';
            if (badge) badge.innerText = '0 workers';
            return;
        }

        if (badge) badge.innerText = `${state.workers.length} workers`;
        list.innerHTML = '';

        state.workers.forEach(w => {
            const card = document.createElement('div');
            card.className = 'activity-card';
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span class="tool-tag tool-tag-worker">${escapeHtml(w.subagentType || 'RESEARCH')} WORKER</span>
                    <span class="status-badge badge-${(w.status || '').toLowerCase()}">${escapeHtml(w.status)}</span>
                </div>
                <div style="font-size: var(--text-sm); font-weight: 600; margin-top: 4px;">Goal: ${escapeHtml(w.goal)}</div>
                ${w.findings ? `<div style="font-size: var(--text-xs); opacity: 0.6; margin-top: 2px;">${escapeHtml(w.findings.slice(0, 180))}...</div>` : ''}
            `;
            list.appendChild(card);
        });
    }

    function renderContextDrawer() {
        const ws = state.workingSet || {};

        // Active file
        if (ws.activeFile) {
            contextActiveFile.innerText = ws.activeFile;
            contextActiveFile.style.cursor = 'pointer';
            contextActiveFile.onclick = () => vscode.postMessage({ type: 'open_file', path: ws.activeFile });
        } else {
            contextActiveFile.innerText = 'None';
            contextActiveFile.style.cursor = 'default';
            contextActiveFile.onclick = null;
        }

        // Inspected files
        const inspected = ws.recentlyInspectedFiles || [];
        countInspected.innerText = `${inspected.length}`;
        if (inspected.length === 0) {
            contextInspectedList.innerHTML = '<span class="empty-subtext">No files inspected</span>';
        } else {
            contextInspectedList.innerHTML = '';
            inspected.forEach(p => {
                const chip = document.createElement('div');
                chip.className = 'context-chip';
                chip.innerText = formatFilePath(p, p);
                chip.title = p;
                chip.addEventListener('click', () => vscode.postMessage({ type: 'open_file', path: p }));
                contextInspectedList.appendChild(chip);
            });
        }

        // Modified files
        const modified = ws.modifiedFiles || [];
        countModified.innerText = `${modified.length}`;
        if (modified.length === 0) {
            contextModifiedList.innerHTML = '<span class="empty-subtext">No files modified</span>';
        } else {
            contextModifiedList.innerHTML = '';
            modified.forEach(m => {
                const chip = document.createElement('div');
                chip.className = 'context-chip';
                chip.innerText = formatFilePath(m.path, m.path);
                chip.title = m.path;
                chip.addEventListener('click', () => vscode.postMessage({ type: 'open_file', path: m.path }));
                contextModifiedList.appendChild(chip);
            });
        }

        // Diagnostics
        const diags = ws.diagnostics || [];
        countDiag.innerText = `${diags.length}`;
        if (diags.length === 0) {
            contextDiagList.innerHTML = '<span class="empty-subtext">Clean — 0 issues</span>';
        } else {
            contextDiagList.innerHTML = '';
            diags.forEach(d => {
                const chip = document.createElement('div');
                chip.className = 'context-chip';
                chip.innerHTML = `<span style="color: var(--comu-error);">●</span> ${escapeHtml(d.message)}`;
                contextDiagList.appendChild(chip);
            });
        }
    }

    function renderComposerControls() {
        const isRunning = state.status === 'running' || state.status === 'starting';
        const isWaiting = state.status === 'waiting_for_user';
        const isCancelling = state.status === 'cancelling';
        const isOffline = state.status === 'offline';

        submitBtn.style.display = (isRunning || isWaiting || isCancelling) ? 'none' : 'flex';
        cancelBtn.style.display = (isRunning || isWaiting || isCancelling) ? 'block' : 'none';

        renderCancellationStatus();

        submitBtn.disabled = isOffline;
        promptInput.disabled = isRunning || isWaiting || isCancelling || isOffline;
        // @ts-ignore
        modeSelect.disabled = isRunning || isWaiting || isCancelling;
    }

    function respondInteraction(response) {
        if (state.taskId && state.pendingInteraction) {
            vscode.postMessage({
                type: 'respond_interaction',
                taskId: state.taskId,
                interactionId: state.pendingInteraction.interactionId,
                response
            });
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 13. MODEL & PROVIDER CATALOG (Phase 14, 15, 31, 32)
    // ═══════════════════════════════════════════════════════════
    function renderModels() {
        modelSelect.innerHTML = '';
        let hasModels = false;

        state.providers.forEach(p => {
            const isReady = p.hasCredential || p.isLocal;
            if (p.models && p.models.length > 0) {
                const group = document.createElement('optgroup');
                group.label = p.displayName + (isReady ? '' : ' (Needs Key)');
                p.models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.name + (isReady ? '' : ' ⚠️');
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
            opt.value = '';
            opt.disabled = true;
            opt.selected = true;
            opt.textContent = 'No models available';
            modelSelect.appendChild(opt);
        } else {
            if (state.selectedModelId && modelSelect.querySelector(`option[value="${state.selectedModelId}"]`)) {
                // @ts-ignore
                modelSelect.value = state.selectedModelId;
            } else {
                const preferred = modelSelect.querySelector('option[data-configured="true"]') || modelSelect.options[0];
                if (preferred) {
                    // @ts-ignore
                    modelSelect.value = preferred.value;
                    // @ts-ignore
                    state.selectedModelId = preferred.value;
                }
            }
        }
        updateHeaderModelBadge();
    }

    function renderProviders() {
        providersContainer.innerHTML = '';

        state.providers.forEach(p => {
            const card = document.createElement('div');
            card.className = 'provider-card';
            card.id = `provider-card-${p.providerId}`;

            let statusClass = 'unconfigured';
            let statusLabel = 'Not Configured';
            let statusIcon = '○';

            if (p.status === 'CONNECTED' || (p.hasCredential && p.status !== 'INVALID_CREDENTIAL' && p.status !== 'NETWORK_ERROR')) {
                statusClass = 'connected';
                statusLabel = 'Connected';
                statusIcon = '●';
            } else if (p.status === 'CONNECTING') {
                statusClass = 'connecting';
                statusLabel = 'Testing…';
                statusIcon = '◌';
            } else if (p.status === 'INVALID_CREDENTIAL') {
                statusClass = 'invalid';
                statusLabel = 'Invalid Key';
                statusIcon = '✕';
            } else if (p.status === 'NETWORK_ERROR') {
                statusClass = 'error';
                statusLabel = 'Network Error';
                statusIcon = '✕';
            }

            const tagText = p.isLocal ? 'Local / On-Device' : (p.providerId === 'nvidia' ? 'Cloud · Nemotron' : 'Cloud');
            const iconEmoji = p.providerId === 'nvidia' ? '✦' : (p.isLocal ? '🦙' : '⚡');

            let cardHtml = `
                <div class="provider-card-header">
                    <div class="provider-card-title-group">
                        <span class="provider-card-icon">${iconEmoji}</span>
                        <span class="provider-card-name">${escapeHtml(p.displayName)}</span>
                        <span class="provider-type-tag">${tagText}</span>
                    </div>
                    <div class="status-pill status-${statusClass}">
                        <span class="status-dot">${statusIcon}</span>
                        <span class="status-text">${statusLabel}</span>
                    </div>
                </div>
                <div class="provider-card-desc">${escapeHtml(p.description || '')}</div>
            `;

            if (p.environmentDetected) {
                cardHtml += `
                    <div class="env-detected-badge">
                        <span>ℹ</span>
                        <span>Detected from environment. You can override it below.</span>
                    </div>
                `;
            }

            if (!p.isLocal) {
                cardHtml += `
                    <div class="provider-form">
                        <div class="form-group">
                            <div class="form-label-row">
                                <label for="input-key-${p.providerId}">API Key</label>
                                ${p.providerId === 'nvidia' ? '<a href="https://build.nvidia.com/" target="_blank" class="get-key-link">Get an NVIDIA key ↗</a>' : ''}
                            </div>
                            <div class="input-with-toggle">
                                <input type="password" id="input-key-${p.providerId}"
                                    placeholder="${p.hasCredential ? '••••••••••••••••••••' : 'Enter API Key'}"
                                    autocomplete="off" spellcheck="false">
                                <button type="button" class="btn-toggle-eye" id="toggle-eye-${p.providerId}" title="Show/Hide">👁</button>
                            </div>
                            <div class="input-helper">Encrypted in VS Code <code>SecretStorage</code>. Never exposed.</div>
                        </div>

                        <div class="form-group">
                            <label for="input-endpoint-${p.providerId}">Endpoint URL</label>
                            <input type="text" id="input-endpoint-${p.providerId}"
                                value="${escapeHtml(p.endpoint || '')}"
                                placeholder="${p.defaultEndpoint || 'https://api.openai.com/v1'}"
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
                            <input type="text" value="${escapeHtml(p.endpoint || 'http://localhost:11434')}" readonly style="opacity: 0.6;">
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

            // Wire Card Events
            if (!p.isLocal) {
                const keyInput = card.querySelector(`#input-key-${p.providerId}`);
                const endpointInput = card.querySelector(`#input-endpoint-${p.providerId}`);
                const toggleEye = card.querySelector(`#toggle-eye-${p.providerId}`);
                const saveBtn = card.querySelector(`#btn-save-${p.providerId}`);
                const testBtn = card.querySelector(`#btn-test-${p.providerId}`);
                const removeBtn = card.querySelector(`#btn-remove-${p.providerId}`);

                if (toggleEye && keyInput) {
                    toggleEye.addEventListener('click', () => {
                        // @ts-ignore
                        keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
                        // @ts-ignore
                        toggleEye.textContent = keyInput.type === 'password' ? '👁' : '🔒';
                    });
                }

                if (saveBtn) {
                    saveBtn.addEventListener('click', () => {
                        // @ts-ignore
                        const keyVal = keyInput ? keyInput.value.trim() : '';
                        // @ts-ignore
                        const endpointVal = endpointInput ? endpointInput.value.trim() : undefined;
                        if (!keyVal && !p.hasCredential) {
                            showProviderTestError(p.providerId, 'Please enter an API key to save.');
                            return;
                        }
                        vscode.postMessage({
                            type: 'save_provider_key',
                            providerId: p.providerId,
                            key: keyVal,
                            endpoint: endpointVal
                        });
                        // @ts-ignore
                        if (keyInput) keyInput.value = '';
                    });
                }

                if (testBtn) {
                    testBtn.addEventListener('click', () => {
                        // @ts-ignore
                        const keyVal = keyInput ? keyInput.value.trim() : '';
                        // @ts-ignore
                        const endpointVal = endpointInput ? endpointInput.value.trim() : undefined;
                        setTestingState(p.providerId);
                        vscode.postMessage({
                            type: 'test_provider',
                            providerId: p.providerId,
                            key: keyVal || undefined,
                            endpoint: endpointVal || undefined
                        });
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
        const testResultEl = document.getElementById(`test-result-${providerId}`);
        if (testResultEl) {
            testResultEl.style.display = 'block';
            testResultEl.className = 'test-result-container testing';
            testResultEl.innerHTML = '<span class="spin">◌</span> Testing connection…';
        }
    }

    function showProviderTestError(providerId, msg) {
        const testResultEl = document.getElementById(`test-result-${providerId}`);
        if (testResultEl) {
            testResultEl.style.display = 'block';
            testResultEl.className = 'test-result-container error';
            testResultEl.innerText = msg;
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
                statusPill.className = 'status-pill status-error';
                statusPill.innerHTML = '<span class="status-dot">✕</span><span class="status-text">Failed</span>';
            }
        }

        const testResultEl = document.getElementById(`test-result-${providerId}`);
        if (testResultEl) {
            testResultEl.style.display = 'block';
            if (isConnected) {
                testResultEl.className = 'test-result-container success';
                const latStr = result.latencyMs ? ` (${result.latencyMs}ms)` : '';
                testResultEl.innerHTML = `✓ <strong>Connected successfully</strong>${latStr}`;
            } else {
                testResultEl.className = 'test-result-container error';
                testResultEl.innerHTML = `✕ <strong>Connection failed:</strong> ${escapeHtml(result.message || 'Check your credentials and endpoint.')}`;
            }
        }
    }

    function appendActivityError(msg) {
        const banner = document.createElement('div');
        banner.className = 'comu-error-banner';
        banner.innerHTML = `⚠️ <span>${escapeHtml(msg)}</span>`;
        timelineList.appendChild(banner);
        activityContainer.scrollTop = activityContainer.scrollHeight;
    }

    // ═══════════════════════════════════════════════════════════
    // 14. RICH TEXT & ESCAPING UTILITIES
    // ═══════════════════════════════════════════════════════════
    function escapeHtml(unsafe) {
        return (unsafe || '').toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function renderRichText(text) {
        if (!text) return '';
        let safe = escapeHtml(text);

        // Fenced code blocks
        safe = safe.replace(/```([a-zA-Z0-9_\-\+]*)\n?([\s\S]*?)```/g, (match, lang, code) => {
            const langLabel = lang ? lang.toUpperCase() : 'CODE';
            const encodedCode = code.replace(/"/g, '&quot;');
            return `<div class="rich-code-block">
                <div class="rich-code-header">
                    <span class="rich-code-lang">${langLabel}</span>
                    <button class="rich-code-copy" data-clipboard="${encodedCode}">Copy</button>
                </div>
                <pre><code>${code.trim()}</code></pre>
            </div>`;
        });

        // Inline code
        safe = safe.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
        // Bold
        safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // Italic
        safe = safe.replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, '$1<em>$2</em>$3');
        // Line breaks outside <pre>
        const parts = safe.split(/(<pre>[\s\S]*?<\/pre>)/gi);
        safe = parts.map((part, i) => i % 2 === 1 ? part : part.replace(/\n/g, '<br/>')).join('');

        return safe;
    }

    // Attach copy button handler
    document.addEventListener('click', async (e) => {
        // @ts-ignore
        if (e.target && e.target.classList && e.target.classList.contains('rich-code-copy')) {
            // @ts-ignore
            const btn = e.target;
            const code = btn.getAttribute('data-clipboard') || '';
            try {
                const unescaped = code
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#039;/g, "'");
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(unescaped);
                }
                const orig = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = orig; }, 2000);
            } catch (err) {
                console.error('Copy failed', err);
            }
        }
    });

    // Delegated click handler on timelineList (prevents per-card listener leaks)
    timelineList.addEventListener('click', (e) => {
        // @ts-ignore
        const target = e.target;
        if (!target) return;

        // Interactive approval / deny buttons
        if (target.closest('#btn-approve')) {
            respondInteraction({ type: 'APPROVE' });
            return;
        }
        if (target.closest('#btn-deny')) {
            respondInteraction({ type: 'DENY' });
            return;
        }
        if (target.closest('#btn-submit-choice')) {
            const radio = timelineList.querySelector('input[name="opt_choice"]:checked');
            // @ts-ignore
            const val = radio ? radio.value : '';
            respondInteraction({ type: 'INPUT', value: val });
            return;
        }

        // Show earlier activity button
        if (target.closest('.btn-show-earlier-activity')) {
            state.showAllActivity = true;
            state.activity = state.fullActivity || state.activity;
            state.hasOlderActivity = false;
            renderActivityTimeline();
            return;
        }

        // Expand/collapse activity card details
        const header = target.closest('.activity-header');
        if (header) {
            const card = header.closest('.activity-card');
            if (card) {
                const panel = card.querySelector('.activity-details-panel');
                if (panel) {
                    card.classList.toggle('expanded');
                    // @ts-ignore
                    panel.style.display = card.classList.contains('expanded') ? 'flex' : 'none';
                }
            }
        }
    });

    // Duration timer ticker
    if (durationTimerInterval) clearInterval(durationTimerInterval);
    durationTimerInterval = setInterval(() => {
        if (state.status === 'running') {
            renderDuration();
        }
    }, 1000);

    // ═══════════════════════════════════════════════════════════
    // 15. INITIAL IMMEDIATE SHELL FIRST PAINT (Phase 2)
    // ═══════════════════════════════════════════════════════════
    const t5 = performance.now();
    logDiag('[COMU RENDER]', `T5: initial render begins (${(t5 - tStartup).toFixed(1)}ms)`);

    // Render fallback static models and providers immediately
    renderProviders();
    renderModels();

    // Render initial static workspace shell immediately (Header, Navigation, Composer, Hero)
    renderWorkspace();

    const t6 = performance.now();
    logDiag('[COMU RENDER]', `T6: first visible COMU shell painted (${(t6 - tStartup).toFixed(1)}ms)`);
    postTelemetry('firstPaintMs', t6 - tStartup);
    postTelemetry('interactiveMs', t6 - tStartup);

    // Initial requests to extension host for background hydration
    vscode.postMessage({ type: 'request_providers' });
    vscode.postMessage({ type: 'ready' });
})();
