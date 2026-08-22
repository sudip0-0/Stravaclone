export type DraftState = 'clear' | 'recording' | 'pending-upload';

export interface DraftStateReporter {
  getDraftState(ownerUserId: string): Promise<DraftState>;
}

export type SignOutDecision =
  | { allowed: true }
  | {
      allowed: false;
      destination: 'Record';
      title: 'Recording in progress';
      message: string;
    }
  | {
      allowed: false;
      destination: 'Activity';
      title: 'Activity not uploaded';
      message: string;
    };

export async function evaluateSignOut(
  reporter: DraftStateReporter,
  ownerUserId: string,
): Promise<SignOutDecision> {
  const state = await reporter.getDraftState(ownerUserId);
  if (state === 'recording')
    return {
      allowed: false,
      destination: 'Record',
      title: 'Recording in progress',
      message:
        'Finish or discard the recording before signing out. Trail won’t remove it here.',
    };
  if (state === 'pending-upload')
    return {
      allowed: false,
      destination: 'Activity',
      title: 'Activity not uploaded',
      message:
        'Signing out is unavailable until the pending activity is uploaded or resolved. Trail won’t remove it here.',
    };
  return { allowed: true };
}

export const clearDraftReporter: DraftStateReporter = Object.freeze({
  async getDraftState() {
    return 'clear' as const;
  },
});
export function resolveDraftReporter(
  reporter?: DraftStateReporter,
): DraftStateReporter {
  return reporter ?? clearDraftReporter;
}
