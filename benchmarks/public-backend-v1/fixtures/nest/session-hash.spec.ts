import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { Session } from '../../src/session/domain/session';
import { SessionService } from '../../src/session/session.service';
import { SessionRelationalRepository } from '../../src/session/infrastructure/persistence/relational/repositories/session.repository';
import { SessionDocumentRepository } from '../../src/session/infrastructure/persistence/document/repositories/session.repository';
import { AuthService } from '../../src/auth/auth.service';

type Conditional = { updateByHash(conditions: { id: number | string; hash: string }, payload: { hash: string }): Promise<Session | null> };
function conditional(value: unknown): Conditional {
  // Both revisions compile. Missing base methods must fail an actual assertion,
  // never masquerade as a successful regression through a TypeScript error.
  expect(typeof (value as Conditional).updateByHash).toBe('function');
  return value as Conditional;
}

function relational() {
  const entity = { id: 31, hash: 'rotated', createdAt: new Date('2025-01-01') };
  const persistence = {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    findOne: jest.fn().mockResolvedValue(entity),
  };
  const repository = new SessionRelationalRepository(persistence as unknown as ConstructorParameters<typeof SessionRelationalRepository>[0]);
  return { entity, persistence, repository };
}

function document() {
  const entity = { _id: '31', user: '41', hash: 'rotated', createdAt: new Date('2025-01-01') };
  const persistence = { findOneAndUpdate: jest.fn().mockResolvedValue(entity) };
  const repository = new SessionDocumentRepository(persistence as unknown as ConstructorParameters<typeof SessionDocumentRepository>[0]);
  return { entity, persistence, repository };
}

test('service delegates both current ID and hash with the replacement hash', async () => {
  const result = Object.assign(new Session(), { id: 31, hash: 'rotated' });
  const persistence = { updateByHash: jest.fn().mockResolvedValue(result) };
  const service = new SessionService(persistence as unknown as ConstructorParameters<typeof SessionService>[0]);
  expect(await conditional(service).updateByHash({ id: 31, hash: 'old' }, { hash: 'rotated' })).toBe(result);
  expect(persistence.updateByHash).toHaveBeenCalledWith({ id: 31, hash: 'old' }, { hash: 'rotated' });
});

test('relational rotation includes ID and old hash in the update predicate', async () => {
  const { entity, persistence, repository } = relational();
  const result = await conditional(repository).updateByHash({ id: '31', hash: 'old' }, { hash: 'rotated' });
  expect(persistence.update).toHaveBeenCalledWith({ id: 31, hash: 'old' }, { hash: 'rotated' });
  expect(persistence.findOne).toHaveBeenCalledWith({ where: { id: 31 } });
  expect(persistence.update.mock.invocationCallOrder[0]).toBeLessThan(persistence.findOne.mock.invocationCallOrder[0]);
  expect(result).toBeInstanceOf(Session);
  expect(result).not.toBe(entity);
  expect(result).toMatchObject({ id: 31, hash: 'rotated' });
});

test('relational no-match returns null without reading an unrelated session', async () => {
  const { persistence, repository } = relational();
  persistence.update.mockResolvedValue({ affected: 0 });
  expect(await conditional(repository).updateByHash({ id: 31, hash: 'stale' }, { hash: 'rotated' })).toBeNull();
  expect(persistence.findOne).not.toHaveBeenCalled();
});

test('relational deletion after update remains null', async () => {
  const { persistence, repository } = relational();
  persistence.findOne.mockResolvedValue(null);
  expect(await conditional(repository).updateByHash({ id: 31, hash: 'old' }, { hash: 'rotated' })).toBeNull();
});

test('relational update errors propagate without a read', async () => {
  const { persistence, repository } = relational();
  const failure = new Error('synthetic update failure');
  persistence.update.mockRejectedValue(failure);
  await expect(conditional(repository).updateByHash({ id: 31, hash: 'old' }, { hash: 'rotated' })).rejects.toBe(failure);
  expect(persistence.findOne).not.toHaveBeenCalled();
});

test('document rotation uses a conditional predicate and requests the updated document', async () => {
  const { entity, persistence, repository } = document();
  const result = await conditional(repository).updateByHash({ id: 31, hash: 'old' }, { hash: 'rotated' });
  expect(persistence.findOneAndUpdate).toHaveBeenCalledTimes(1);
  const [filter, update, options] = persistence.findOneAndUpdate.mock.calls[0];
  expect(filter).toEqual({ _id: '31', hash: 'old' });
  expect(update).toEqual({ hash: 'rotated' });
  expect(options?.new === true || options?.returnDocument === 'after').toBe(true);
  expect(result).toBeInstanceOf(Session);
  expect(result).not.toBe(entity);
  expect(result).toMatchObject({ id: '31', hash: 'rotated', user: { id: '41' } });
});

test('document no-match remains null and persistence errors propagate', async () => {
  const { persistence, repository } = document();
  const method = conditional(repository);
  persistence.findOneAndUpdate.mockResolvedValueOnce(null);
  expect(await method.updateByHash({ id: 31, hash: 'stale' }, { hash: 'rotated' })).toBeNull();
  const failure = new Error('synthetic document failure');
  persistence.findOneAndUpdate.mockRejectedValueOnce(failure);
  await expect(method.updateByHash({ id: 31, hash: 'old' }, { hash: 'rotated' })).rejects.toBe(failure);
});

function authentication() {
  const current = { id: 31, user: { id: 41 }, hash: 'old' };
  const session = {
    findById: jest.fn().mockResolvedValue(current),
    update: jest.fn().mockResolvedValue(current),
    updateByHash: jest.fn(async (_conditions, payload) => ({ ...current, hash: payload.hash })),
  };
  const jwt = { signAsync: jest.fn(async (payload) => payload.hash ? 'refresh-' + payload.hash : 'access-token') };
  const users = { findById: jest.fn().mockResolvedValue({ id: 41, role: { id: 1 } }) };
  const config = { getOrThrow: jest.fn((key: string) => ({
    'auth.expires': '15m', 'auth.refreshExpires': '30d',
    'auth.secret': 'synthetic-test-key', 'auth.refreshSecret': 'synthetic-refresh-key',
  }[key])) };
  const service = new AuthService(jwt as any, users as any, session as any, {} as any, config as any);
  return { current, session, jwt, users, service };
}

test('auth signs only after conditional rotation and embeds the rotated hash', async () => {
  const { session, jwt, service } = authentication();
  const result = await service.refreshToken({ sessionId: 31, hash: 'old' });
  expect(session.updateByHash).toHaveBeenCalledTimes(1);
  expect(session.updateByHash.mock.calls[0][0]).toEqual({ id: 31, hash: 'old' });
  const rotated = session.updateByHash.mock.calls[0][1].hash;
  expect(rotated).toMatch(/^[a-f0-9]{64}$/);
  expect(rotated).not.toBe('old');
  expect(session.findById).not.toHaveBeenCalled();
  expect(session.update).not.toHaveBeenCalled();
  expect(session.updateByHash.mock.invocationCallOrder[0]).toBeLessThan(jwt.signAsync.mock.invocationCallOrder[0]);
  expect(jwt.signAsync.mock.calls.map(call => call[0])).toContainEqual({ sessionId: 31, hash: rotated });
  expect(result).toMatchObject({ token: 'access-token', refreshToken: 'refresh-' + rotated });
});

test('a failed conditional match cannot issue tokens despite plausible prior session state', async () => {
  const { session, jwt, users, service } = authentication();
  session.updateByHash.mockResolvedValueOnce(null as any);
  await expect(service.refreshToken({ sessionId: 31, hash: 'old' })).rejects.toBeInstanceOf(UnauthorizedException);
  expect(jwt.signAsync).not.toHaveBeenCalled();
  expect(users.findById).not.toHaveBeenCalled();
});

test('an absent session is rejected without issuing tokens', async () => {
  const { session, jwt, service } = authentication();
  session.findById.mockResolvedValueOnce(null);
  session.updateByHash.mockResolvedValueOnce(null as any);
  await expect(service.refreshToken({ sessionId: 31, hash: 'old' })).rejects.toBeInstanceOf(UnauthorizedException);
  expect(jwt.signAsync).not.toHaveBeenCalled();
});

test('auth waits for conditional persistence before signing', async () => {
  const { current, session, jwt, service } = authentication();
  let release!: (value: any) => void;
  session.updateByHash.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = service.refreshToken({ sessionId: 31, hash: 'old' });
  await new Promise(resolve => setImmediate(resolve));
  try {
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(typeof release).toBe('function');
  } finally {
    if (release) release(current);
    await pending.catch(() => {});
  }
});

test('conditional persistence errors and a missing user do not produce tokens', async () => {
  const { session, jwt, users, service } = authentication();
  const failure = new Error('synthetic persistence failure');
  session.updateByHash.mockRejectedValueOnce(failure);
  await expect(service.refreshToken({ sessionId: 31, hash: 'old' })).rejects.toBe(failure);
  expect(jwt.signAsync).not.toHaveBeenCalled();
  users.findById.mockResolvedValueOnce(null);
  await expect(service.refreshToken({ sessionId: 31, hash: 'old' })).rejects.toBeInstanceOf(UnauthorizedException);
  expect(jwt.signAsync).not.toHaveBeenCalled();
});
