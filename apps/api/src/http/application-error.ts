import type { ErrorCode } from '@trail/contracts';

export class ApplicationError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly publicMessage: string;

  constructor(options: {
    readonly code: ErrorCode;
    readonly statusCode: number;
    readonly publicMessage: string;
  }) {
    super(options.publicMessage);
    this.name = 'ApplicationError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.publicMessage = options.publicMessage;
  }
}
