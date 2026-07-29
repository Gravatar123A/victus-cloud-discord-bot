import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isActiveFreeServer,
    isActivePaidService,
    resolveEntitlementRole,
} from '../dist/services/entitlementRules.js';

const now = new Date('2026-07-28T12:00:00.000Z');

test('paid entitlement takes precedence over a free server', () => {
    assert.equal(resolveEntitlementRole(true, true), 'paid');
    assert.equal(resolveEntitlementRole(false, true), 'free');
    assert.equal(resolveEntitlementRole(false, false), 'none');
});

test('free server is active only before its renewal deadline and while unpaused', () => {
    const active = { server_type: 'free', renewal_deadline: '2026-07-29T12:00:00.000Z', status: null };
    assert.equal(isActiveFreeServer(active, now), true);
    assert.equal(isActiveFreeServer({ ...active, renewal_deadline: '2026-07-27T12:00:00.000Z' }, now), false);
    assert.equal(isActiveFreeServer({ ...active, is_paused_due_to_renewal: true }, now), false);
    assert.equal(isActiveFreeServer({ ...active, status: 'suspended' }, now), false);
    assert.equal(isActiveFreeServer({ ...active, server_type: 'paid' }, now), false);
});

test('paid service must be active, non-free, and unexpired', () => {
    const active = { status: 'active', plan_type: 'recurring', expires_at: '2026-08-28T12:00:00.000Z' };
    assert.equal(isActivePaidService(active, now), true);
    assert.equal(isActivePaidService({ ...active, expires_at: '2026-07-27T12:00:00.000Z' }, now), false);
    assert.equal(isActivePaidService({ ...active, status: 'suspended' }, now), false);
    assert.equal(isActivePaidService({ ...active, plan_type: 'free' }, now), false);
    assert.equal(isActivePaidService({ status: 'active', plan_type: 'one-time', expires_at: null }, now), true);
});