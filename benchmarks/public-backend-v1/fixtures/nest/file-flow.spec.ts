import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';
import { Repository } from 'typeorm';
import { FileRelationalRepository } from '../../src/files/infrastructure/persistence/relational/repositories/file.repository';
import { FileEntity } from '../../src/files/infrastructure/persistence/relational/entities/file.entity';
import { FileType } from '../../src/files/domain/file';
import { ResolvePromisesInterceptor } from '../../src/utils/serializer.interceptor';

// Exercise real mapping/interceptor code; only the persistence boundary is mocked.
// No application bootstrap, env-file loading, database, or S3 requests.
function fixture() {
  const stored = Object.assign(new FileEntity(), { id: 'saved-id', path: '/saved-path', __entity: 'FileEntity' });
  const persistence = {
    create: jest.fn((entity) => entity), save: jest.fn().mockResolvedValue(stored),
    findOne: jest.fn().mockResolvedValue(stored), find: jest.fn().mockResolvedValue([stored]),
  };
  return { stored, persistence, repository: new FileRelationalRepository(persistence as unknown as Repository<FileEntity>) };
}

test('create returns mapped domain data from the saved entity', async () => {
  const { stored, persistence, repository } = fixture();
  const input = Object.assign(new FileType(), { id: 'input-id', path: '/input-path' });
  const result = await repository.create(input);
  expect(persistence.create).toHaveBeenCalledTimes(1);
  expect(persistence.create.mock.calls[0][0]).toBeInstanceOf(FileEntity);
  expect(persistence.create.mock.calls[0][0]).toMatchObject(input);
  expect(persistence.save).toHaveBeenCalledWith(persistence.create.mock.results[0].value);
  expect(result).toBeInstanceOf(FileType);
  expect(result).not.toBe(stored);
  expect(Object.keys(result).sort()).toEqual(['id', 'path']);
  expect(result).toEqual({ id: 'saved-id', path: '/saved-path' });
  expect(input).toEqual({ id: 'input-id', path: '/input-path' });
});

test('create propagates persistence failure without returning a file', async () => {
  const { persistence, repository } = fixture();
  const failure = new Error('synthetic persistence failure');
  persistence.save.mockRejectedValue(failure);
  await expect(repository.create(Object.assign(new FileType(), { path: '/input' }))).rejects.toBe(failure);
  expect(persistence.save).toHaveBeenCalledTimes(1);
});

test('findById maps existing files and preserves missing-file null', async () => {
  const { persistence, repository } = fixture();
  const result = await repository.findById('saved-id');
  expect(persistence.findOne).toHaveBeenCalledWith({ where: { id: 'saved-id' } });
  expect(result).toBeInstanceOf(FileType);
  expect(Object.keys(result!).sort()).toEqual(['id', 'path']);
  persistence.findOne.mockResolvedValueOnce(null);
  expect(await repository.findById('missing')).toBeNull();
});

test('findByIds maps each returned entity and preserves an empty result', async () => {
  const { persistence, repository } = fixture();
  const result = await repository.findByIds(['saved-id']);
  expect(result).toHaveLength(1);
  expect(result[0]).toBeInstanceOf(FileType);
  expect(result[0]).toEqual({ id: 'saved-id', path: '/saved-path' });
  expect(persistence.find.mock.calls[0][0].where.id.value).toEqual(['saved-id']);
  persistence.find.mockResolvedValueOnce([]);
  expect(await repository.findByIds([])).toEqual([]);
});

test('interceptor emits resolved nested values rather than Promise objects', async () => {
  const date = new Date('2025-01-02T00:00:00.000Z');
  const stream = new ResolvePromisesInterceptor().intercept({} as ExecutionContext, {
    handle: () => of({ file: { path: Promise.resolve('/resolved') }, list: [Promise.resolve('item')], date, empty: null }, 7),
  });
  // Collect actual emissions; awaiting a single emission would assimilate a
  // Promise and hide the base revision's map-versus-mergeMap bug.
  const values = await firstValueFrom(stream.pipe(toArray()));
  expect(values).toHaveLength(2);
  expect(values.every((value) => !(value instanceof Promise))).toBe(true);
  expect(values).toContainEqual({ file: { path: '/resolved' }, list: ['item'], date, empty: null });
  expect(values).toContain(7);
});

test('interceptor routes rejected values through the observable error channel', async () => {
  const failure = new Error('synthetic resolver failure');
  const values: unknown[] = [];
  const stream = new ResolvePromisesInterceptor().intercept({} as ExecutionContext, {
    handle: () => of(Promise.reject(failure)),
  });
  const observed = await new Promise<unknown>((resolve) => stream.subscribe({
    next: (value) => { values.push(value); if (value instanceof Promise) value.catch(() => {}); },
    error: resolve, complete: () => resolve(null),
  }));
  expect(observed).toBe(failure);
  expect(values).toEqual([]);
});

test('interceptor preserves an upstream observable failure', async () => {
  const failure = new Error('synthetic upstream failure');
  const stream = new ResolvePromisesInterceptor().intercept({} as ExecutionContext, {
    handle: () => throwError(() => failure),
  });
  await expect(firstValueFrom(stream)).rejects.toBe(failure);
});
