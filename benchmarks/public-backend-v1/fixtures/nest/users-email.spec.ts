import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { UsersService } from '../../src/users/users.service';

// Execute the actual service. Persistence and file lookup are the boundaries;
// no app bootstrap, env file, database or mail service is started.
function fixture() {
  const stored = { id: 42, email: 'new@example.invalid' };
  const repository = {
    findOne: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(stored),
  };
  const files = { findOne: jest.fn() };
  const service = new UsersService(
    repository as unknown as ConstructorParameters<typeof UsersService>[0],
    files as unknown as ConstructorParameters<typeof UsersService>[1],
  );
  return { service, repository, files, stored };
}

test('unused email reaches persistence and does not mutate caller payload', async () => {
  const { service, repository, files, stored } = fixture();
  const payload = Object.freeze({ email: 'new@example.invalid' });
  expect(await service.update(42, payload)).toBe(stored);
  expect(repository.findOne).toHaveBeenCalledWith({ email: payload.email });
  expect(repository.update).toHaveBeenCalledTimes(1);
  expect(repository.update).toHaveBeenCalledWith(42, payload);
  expect(payload).toEqual({ email: 'new@example.invalid' });
  expect(files.findOne).not.toHaveBeenCalled();
});

test('the same account may retain its existing email', async () => {
  const { service, repository, stored } = fixture();
  repository.findOne.mockResolvedValue({ id: 42, email: stored.email });
  expect(await service.update(42, { email: stored.email })).toBe(stored);
  expect(repository.update).toHaveBeenCalledTimes(1);
});

test('another account email is rejected without any persistence update', async () => {
  const { service, repository } = fixture();
  repository.findOne.mockResolvedValue({ id: 99, email: 'taken@example.invalid' });
  const failure = await service.update(42, { email: 'taken@example.invalid' }).catch(error => error);
  expect(failure).toBeInstanceOf(HttpException);
  expect(failure.getStatus()).toBe(422);
  expect(failure.getResponse()).toMatchObject({ errors: { email: 'emailAlreadyExists' } });
  expect(repository.update).not.toHaveBeenCalled();
});

test('an update without email does not perform an email uniqueness lookup', async () => {
  const { service, repository } = fixture();
  await service.update(42, { firstName: 'Example' });
  expect(repository.findOne).not.toHaveBeenCalled();
  expect(repository.update).toHaveBeenCalledWith(42, { firstName: 'Example' });
});

test('email lookup failure propagates and prevents a write', async () => {
  const { service, repository } = fixture();
  const failure = new Error('synthetic lookup failure');
  repository.findOne.mockRejectedValue(failure);
  await expect(service.update(42, { email: 'new@example.invalid' })).rejects.toBe(failure);
  expect(repository.update).not.toHaveBeenCalled();
});

test('persistence failure is not replaced by an email conflict', async () => {
  const { service, repository } = fixture();
  const failure = new Error('synthetic persistence failure');
  repository.update.mockRejectedValue(failure);
  await expect(service.update(42, { email: 'new@example.invalid' })).rejects.toBe(failure);
  expect(repository.update).toHaveBeenCalledTimes(1);
});

test('a missing update result remains null rather than a fabricated account', async () => {
  const { service, repository } = fixture();
  repository.update.mockResolvedValue(null);
  expect(await service.update(42, { email: 'new@example.invalid' })).toBeNull();
});
