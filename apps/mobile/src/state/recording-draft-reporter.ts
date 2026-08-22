import type { RecordingRepository } from '../features/record/recording-types';
import type { DraftStateReporter } from './draft-guard';

export class RecordingDraftStateReporter implements DraftStateReporter {
  constructor(private readonly repository: RecordingRepository) {}
  async getDraftState(ownerUserId: string) {
    await this.repository.migrate();
    const active = await this.repository.getRecoverableSession(ownerUserId);
    if (active) return 'recording' as const;
    return (await this.repository.hasPendingSync(ownerUserId))
      ? ('pending-upload' as const)
      : ('clear' as const);
  }
}
