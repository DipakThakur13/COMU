import * as assert from 'assert';
import { TaskSessionStore } from '../../sessions/task_session_store';
import { AgentEvent } from '@comu/protocol';

suite('TaskSessionStore Test Suite', () => {
    test('Should add event and maintain event history', () => {
        const store = new TaskSessionStore();
        
        const event: AgentEvent = {
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
        const store = new TaskSessionStore();
        
        const event: AgentEvent = {
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
        const store = new TaskSessionStore();
        
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
        const store = new TaskSessionStore();
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
        const store = new TaskSessionStore();
        store.setOffline(true);
        assert.strictEqual(store.getState().status, 'offline');

        store.setOffline(false);
        assert.strictEqual(store.getState().status, 'idle');
    });
});
