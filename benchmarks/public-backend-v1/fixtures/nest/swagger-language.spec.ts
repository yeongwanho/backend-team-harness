import 'reflect-metadata';

jest.mock('dotenv/config', () => ({}));
jest.mock('../../src/app.module', () => {
  const { Module, Controller, Get } = require('@nestjs/common');
  const { ConfigService } = require('@nestjs/config');
  class ProbeController { probe() { return { ok: true }; } }
  Controller('probe')(ProbeController);
  Get()(ProbeController.prototype, 'probe', Object.getOwnPropertyDescriptor(ProbeController.prototype, 'probe'));
  class AppModule {}
  Module({
    controllers: [ProbeController],
    providers: [{ provide: ConfigService, useValue: {
      getOrThrow(key: string) {
        if (key === 'app.apiPrefix') return 'api';
        if (key === 'app.port') return 3000;
        throw new Error('Unexpected bootstrap setting: ' + key);
      },
    } }],
  })(AppModule);
  return { AppModule };
});

// Real bootstrap, Nest container and Swagger generation; synthetic module only.
// Listening is intercepted before bootstrap receives the app. No port is bound.
async function languageHeader(configured: string | undefined, expected: string) {
  jest.resetModules();
  const previous = process.env.APP_HEADER_LANGUAGE;
  if (configured === undefined) delete process.env.APP_HEADER_LANGUAGE;
  else process.env.APP_HEADER_LANGUAGE = configured;
  const { NestFactory } = require('@nestjs/core');
  const { SwaggerModule } = require('@nestjs/swagger');
  const originalCreate = NestFactory.create.bind(NestFactory);
  let app: any;
  let complete!: () => void;
  const booted = new Promise<void>(resolve => { complete = resolve; });
  const listen = jest.fn(async () => { complete(); return undefined; });
  jest.spyOn(NestFactory, 'create').mockImplementation(async (...args: any[]) => {
    app = await originalCreate(args[0], { ...args[1], logger: false });
    // Nest returns a proxy that wraps methods, so spying on app.listen loses
    // Jest's mock properties. Intercept at our own outer proxy instead.
    return new Proxy(app, { get(target, property, receiver) {
      return property === 'listen' ? listen : Reflect.get(target, property, receiver);
    } });
  });
  const documentSpy = jest.spyOn(SwaggerModule, 'createDocument');
  const setupSpy = jest.spyOn(SwaggerModule, 'setup');
  try {
    require('../../src/main');
    await booted;
    expect(documentSpy).toHaveBeenCalledTimes(1);
    expect(setupSpy).toHaveBeenCalledTimes(1);
    const document: any = documentSpy.mock.results[0].value;
    const operations = Object.values(document.paths).flatMap((path: any) => Object.values(path));
    expect(operations.length).toBeGreaterThan(0);
    for (const operation of operations as any[]) {
      const parameters = (operation.parameters ?? []).filter((parameter: any) => parameter.in === 'header' && parameter.name === expected);
      expect(parameters).toHaveLength(1);
      expect(parameters[0].required).toBe(false);
      expect(parameters[0].schema?.example ?? parameters[0].example).toBe('en');
    }
    expect(listen).toHaveBeenCalledTimes(1);
  } finally {
    if (app) await app.close();
    jest.restoreAllMocks();
    if (previous === undefined) delete process.env.APP_HEADER_LANGUAGE;
    else process.env.APP_HEADER_LANGUAGE = previous;
  }
}

test('configured language header is optional with an English example in generated operations', async () => {
  await languageHeader('x-study-language', 'x-study-language');
});

test('an unset language setting falls back to x-custom-lang', async () => {
  await languageHeader(undefined, 'x-custom-lang');
});

test('an empty language setting falls back to x-custom-lang', async () => {
  await languageHeader('', 'x-custom-lang');
});
