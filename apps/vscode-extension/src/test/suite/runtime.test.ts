import * as assert from 'assert';
import { RuntimeClient } from '../../runtime/runtime_client';

suite('RuntimeClient Test Suite', () => {
    test('Should construct client and format URLs correctly', () => {
        const client = new RuntimeClient();
        const url = client.getEventStreamUrl('test-task-123');
        assert.ok(url.includes('test-task-123/events'));
        assert.ok(url.startsWith('http'));
    });
});
