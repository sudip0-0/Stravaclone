import { describe, expect, it } from 'vitest';
import { MemoryRecordingRepository } from '../features/record/recording-test-repository';
import { RecordingDraftStateReporter } from './recording-draft-reporter';
const A = 'owner-a';
const B = 'owner-b';

describe('owner-scoped durable DraftStateReporter', () => {
  it('does not reveal another account recording', async () => {
    const repository = new MemoryRecordingRepository();
    await repository.createRecordingSession({
      id: 'active',
      ownerUserId: A,
      sport: 'run',
      backgroundEnabled: true,
      nowMs: 1,
    });
    const reporter = new RecordingDraftStateReporter(repository);
    expect(await reporter.getDraftState(A)).toBe('recording');
    expect(await reporter.getDraftState(B)).toBe('clear');
  });
  it('reports pending work only to its owner', async () => {
    const repository = new MemoryRecordingRepository();
    repository.pendingOwners.add(A);
    const reporter = new RecordingDraftStateReporter(repository);
    expect(await reporter.getDraftState(A)).toBe('pending-upload');
    expect(await reporter.getDraftState(B)).toBe('clear');
  });
});
