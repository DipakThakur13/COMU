"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const task_session_store_1 = require("../../sessions/task_session_store");
suite('TaskSessionStore Test Suite', () => {
    test('Should add event and maintain event history', () => {
        const store = new task_session_store_1.TaskSessionStore();
        const event = {
            type: 'task.started',
            eventId: '1',
            taskId: 'task1',
            timestamp: new Date().toISOString()
        };
        const added = store.addEvent(event);
        assert.strictEqual(added, true);
        const events = store.getState().events;
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].eventId, '1');
    });
    test('Should ignore duplicate events', () => {
        const store = new task_session_store_1.TaskSessionStore();
        const event = {
            type: 'task.started',
            eventId: '1',
            taskId: 'task1',
            timestamp: new Date().toISOString()
        };
        store.addEvent(event);
        const addedAgain = store.addEvent(event);
        assert.strictEqual(addedAgain, false);
        assert.strictEqual(store.getState().events.length, 1);
    });
    test('Should track changes correctly', () => {
        const store = new task_session_store_1.TaskSessionStore();
        store.addEvent({
            type: 'change.created',
            eventId: '1',
            taskId: 'task1',
            timestamp: new Date().toISOString(),
            path: '/test/file.ts',
            operation: 'CREATE'
        });
        const changes = store.getState().changes;
        assert.strictEqual(changes.length, 1);
        assert.strictEqual(changes[0].path, '/test/file.ts');
        assert.strictEqual(changes[0].operation, 'CREATE');
    });
    test('Should update status based on events', () => {
        const store = new task_session_store_1.TaskSessionStore();
        assert.strictEqual(store.getState().status, 'idle');
        store.startNewTask('t1', 'prompt', 'm1');
        assert.strictEqual(store.getState().status, 'running');
        store.addEvent({ type: 'agent.status', status: 'Thinking', eventId: '2', taskId: 't1', timestamp: '' });
        assert.strictEqual(store.getState().status, 'running'); // remains running
        assert.strictEqual(store.getState().events.find(e => e.type === 'agent.status')?.status, 'Thinking');
        store.addEvent({ type: 'task.completed', eventId: '3', taskId: 't1', timestamp: '' });
        assert.strictEqual(store.getState().status, 'completed');
    });
    test('Should handle offline state independently', () => {
        const store = new task_session_store_1.TaskSessionStore();
        store.setOffline(true);
        assert.strictEqual(store.getState().status, 'offline');
        store.setOffline(false);
        assert.strictEqual(store.getState().status, 'idle');
    });
});
//# sourceMappingURL=sessions.test.js.map