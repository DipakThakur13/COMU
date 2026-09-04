import { describe, it, beforeEach } from 'vitest';
import { expect } from 'chai';
import { CommandPolicy } from '../src/policy';
import { CommandPlan } from '../src/command_plan';

describe('CommandPolicy', () => {
  let policy: CommandPolicy;

  beforeEach(() => {
    policy = new CommandPolicy();
  });

  it('should allow safe development commands', () => {
    const plan: CommandPlan = {
      executable: 'npm',
      args: ['test'],
      cwd: '/tmp',
      source: 'AGENT'
    };
    const decision = policy.evaluate(plan);
    expect(decision.decision).to.equal('ALLOW');
    expect(decision.category).to.equal('SAFE_DEVELOPMENT');
  });

  it('should deny shell injection', () => {
    const plan: CommandPlan = {
      executable: 'npm',
      args: ['test', ';', 'rm', '-rf', '/'],
      cwd: '/tmp',
      source: 'AGENT'
    };
    const decision = policy.evaluate(plan);
    expect(decision.decision).to.equal('DENY');
    expect(decision.category).to.equal('RESTRICTED');
  });

  it('should deny inline interpreters', () => {
    const plan: CommandPlan = {
      executable: 'node',
      args: ['-e', 'console.log(process.env)'],
      cwd: '/tmp',
      source: 'AGENT'
    };
    const decision = policy.evaluate(plan);
    expect(decision.decision).to.equal('DENY');
    expect(decision.category).to.equal('RESTRICTED');
  });

  it('should deny destructive commands', () => {
    const plan: CommandPlan = {
      executable: 'rm',
      args: ['-rf', '/tmp'],
      cwd: '/tmp',
      source: 'AGENT'
    };
    const decision = policy.evaluate(plan);
    expect(decision.decision).to.equal('DENY');
    expect(decision.category).to.equal('DESTRUCTIVE');
  });

  it('should deny network commands', () => {
    const plan: CommandPlan = {
      executable: 'curl',
      args: ['http://example.com'],
      cwd: '/tmp',
      source: 'AGENT'
    };
    const decision = policy.evaluate(plan);
    expect(decision.decision).to.equal('DENY');
    expect(decision.category).to.equal('NETWORK');
  });
});
