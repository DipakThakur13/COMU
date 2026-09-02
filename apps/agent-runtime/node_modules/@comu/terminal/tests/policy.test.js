"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const policy_1 = require("../src/policy");
describe('CommandPolicy', () => {
    let policy;
    beforeEach(() => {
        policy = new policy_1.CommandPolicy();
    });
    it('should allow safe development commands', () => {
        const plan = {
            executable: 'npm',
            args: ['test'],
            cwd: '/tmp',
            source: 'AGENT'
        };
        const decision = policy.evaluate(plan);
        (0, chai_1.expect)(decision.decision).to.equal('ALLOW');
        (0, chai_1.expect)(decision.category).to.equal('SAFE_DEVELOPMENT');
    });
    it('should deny shell injection', () => {
        const plan = {
            executable: 'npm',
            args: ['test', ';', 'rm', '-rf', '/'],
            cwd: '/tmp',
            source: 'AGENT'
        };
        const decision = policy.evaluate(plan);
        (0, chai_1.expect)(decision.decision).to.equal('DENY');
        (0, chai_1.expect)(decision.category).to.equal('RESTRICTED');
    });
    it('should deny inline interpreters', () => {
        const plan = {
            executable: 'node',
            args: ['-e', 'console.log(process.env)'],
            cwd: '/tmp',
            source: 'AGENT'
        };
        const decision = policy.evaluate(plan);
        (0, chai_1.expect)(decision.decision).to.equal('DENY');
        (0, chai_1.expect)(decision.category).to.equal('RESTRICTED');
    });
    it('should deny destructive commands', () => {
        const plan = {
            executable: 'rm',
            args: ['-rf', '/tmp'],
            cwd: '/tmp',
            source: 'AGENT'
        };
        const decision = policy.evaluate(plan);
        (0, chai_1.expect)(decision.decision).to.equal('DENY');
        (0, chai_1.expect)(decision.category).to.equal('DESTRUCTIVE');
    });
    it('should deny network commands', () => {
        const plan = {
            executable: 'curl',
            args: ['http://example.com'],
            cwd: '/tmp',
            source: 'AGENT'
        };
        const decision = policy.evaluate(plan);
        (0, chai_1.expect)(decision.decision).to.equal('DENY');
        (0, chai_1.expect)(decision.category).to.equal('NETWORK');
    });
});
//# sourceMappingURL=policy.test.js.map