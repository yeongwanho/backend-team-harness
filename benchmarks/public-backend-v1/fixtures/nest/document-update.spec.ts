import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { UsersDocumentRepository } from '../../src/users/infrastructure/persistence/document/repositories/user.repository';
import { SessionDocumentRepository } from '../../src/session/infrastructure/persistence/document/repositories/session.repository';

// Domain decorators query database configuration at import time. Supply only
// their document-ID mode; do not read credentials or replace domain/repository code.
jest.mock('../../src/database/config/database.config', () => ({
  __esModule: true, default: () => ({ isDocumentDatabase: true }),
}));

// Actual repositories/mappers execute; persistence/configuration are boundaries.
// This is not proof of a live MongoDB, app bootstrap or Hygen CLI.
const before = new Date('2024-01-01T00:00:00Z');
const after = new Date('2024-02-01T00:00:00Z');
const root = resolve(__dirname, '../..');
type RecordValue = Record<string, any>;
type Repository = { update(id: string, payload: RecordValue): Promise<any> };
type Variant = {
  name: string;
  create: (model: any) => Repository;
  stored: RecordValue;
  payload: RecordValue;
  field: string;
  missing: 'null' | 'error';
};

function generatedRepository(kind: string): new (model: any) => Repository {
  const ejs = require('ejs');
  const inflection = require('inflection');
  const prefix = `.hygen/generate/${kind}/infrastructure/persistence/document/`;
  const render = (path: string) => {
    const template = readFileSync(resolve(root, prefix + path), 'utf8');
    const body = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(template);
    if (!body) throw new Error('Expected original Hygen front matter');
    return ejs.render(template.slice(body[0].length), { name: 'Widget', h: { inflection } });
  };
  const load = (source: string, imports: RecordValue) => {
    const compiled = ts.transpileModule(source, {
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021,
        experimentalDecorators: true, emitDecoratorMetadata: true },
    });
    if (compiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) {
      throw new Error('Generated repository syntax is invalid');
    }
    const module = { exports: {} as RecordValue };
    new Function('require', 'module', 'exports', compiled.outputText)((path: string) => {
      if (Object.prototype.hasOwnProperty.call(imports, path)) return imports[path];
      throw new Error('Unexpected generated runtime dependency: ' + path);
    }, module, module.exports);
    return module.exports;
  };
  // These classes carry data only. The unchanged generated mapper itself is
  // rendered and executed, rather than replacing its ID/date mapping with a mock.
  class Widget {}
  class WidgetSchemaClass {}
  const imports = {
    '../../../../domain/widget': { Widget },
    '../entities/widget.schema': { WidgetSchemaClass },
  };
  const mapper = load(render('mappers/mapper.ejs.t'), imports);
  const repository = load(render('repositories/repository.ejs.t'), {
    ...imports,
    '../mappers/widget.mapper': mapper,
    '@nestjs/common': require('@nestjs/common'),
    '@nestjs/mongoose': require('@nestjs/mongoose'),
    mongoose: require('mongoose'),
  });
  return repository.WidgetDocumentRepository;
}

const variants: Variant[] = [
  {
    name: 'user', create: model => new UsersDocumentRepository(model),
    stored: { _id: 'user-42', email: 'old@example.invalid', firstName: 'Unchanged', createdAt: before },
    payload: { id: 'must-not-replace-id', email: 'new@example.invalid' }, field: 'email', missing: 'null',
  },
  {
    name: 'session', create: model => new SessionDocumentRepository(model),
    stored: { _id: 'session-42', hash: 'old-hash', user: { _id: 'user-42' }, createdAt: before },
    payload: { id: 'must-not-replace-id', hash: 'new-hash', createdAt: after }, field: 'hash', missing: 'null',
  },
  ...['document-resource', 'all-db-resource'].map(kind => ({
    name: kind, create: (model: any) => new (generatedRepository(kind))(model),
    stored: { _id: 'widget-42', createdAt: before, updatedAt: before },
    payload: { id: 'must-not-replace-id', updatedAt: after }, field: 'updatedAt', missing: 'error' as const,
  })),
];

function fixture(variant: Variant) {
  const original = structuredClone(variant.stored);
  const model = {
    findOne: jest.fn().mockResolvedValue(structuredClone(original)),
    findOneAndUpdate: jest.fn().mockImplementation(async (_filter, data, options) => {
      // Support equivalent documented choices, not just the target's spelling.
      const selectedAfter = options?.new === true || options?.returnDocument === 'after' || options?.returnOriginal === false;
      return selectedAfter ? { ...structuredClone(original), ...data } : structuredClone(original);
    }),
  };
  return { repository: variant.create(model), model, original };
}

for (const variant of variants) {
  test(`${variant.name} returns the changed document and preserves caller ID and untouched data`, async () => {
    const { repository, model, original } = fixture(variant);
    const payload = Object.freeze(structuredClone(variant.payload));
    const result = await repository.update(original._id, payload);
    expect(result[variant.field]).toEqual(payload[variant.field]);
    expect(result.id).toBe(original._id);
    expect(result.createdAt).toEqual(before);
    expect(model.findOne).toHaveBeenCalledWith({ _id: original._id });
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update] = model.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: original._id });
    expect(update._id).toBe(original._id);
    expect(update[variant.field]).toEqual(payload[variant.field]);
    if (variant.name === 'user') expect(result.firstName).toBe('Unchanged');
    if (variant.name === 'session') expect(result.user.id).toBe('user-42');
    expect(payload).toEqual(variant.payload);
    await expect(model.findOne.mock.results[0].value).resolves.toEqual(original);
  });

  test(`${variant.name} preserves initial missing-document behavior without an update`, async () => {
    const { repository, model, original } = fixture(variant);
    model.findOne.mockResolvedValue(null);
    const result = repository.update(original._id, variant.payload);
    if (variant.missing === 'null') await expect(result).resolves.toBeNull();
    else await expect(result).rejects.toThrow('Record not found');
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test(`${variant.name} returns null when the document disappears during update`, async () => {
    const { repository, model, original } = fixture(variant);
    model.findOneAndUpdate.mockResolvedValue(null);
    await expect(repository.update(original._id, variant.payload)).resolves.toBeNull();
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  test(`${variant.name} propagates lookup failure without a write`, async () => {
    const { repository, model, original } = fixture(variant);
    const failure = new Error('synthetic lookup failure');
    model.findOne.mockRejectedValue(failure);
    await expect(repository.update(original._id, variant.payload)).rejects.toBe(failure);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test(`${variant.name} propagates update failure without returning stale data`, async () => {
    const { repository, model, original } = fixture(variant);
    const failure = new Error('synthetic update failure');
    model.findOneAndUpdate.mockRejectedValue(failure);
    await expect(repository.update(original._id, variant.payload)).rejects.toBe(failure);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
}
