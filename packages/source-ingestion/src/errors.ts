import type { AcquisitionBlockReason } from "./types.ts";

export class AcquisitionDeniedError extends Error {
  readonly blockReason: AcquisitionBlockReason;
  readonly errorCode: string;

  constructor(blockReason: AcquisitionBlockReason, errorCode: string, message: string) {
    super(message);
    this.name = "AcquisitionDeniedError";
    this.blockReason = blockReason;
    this.errorCode = errorCode;
  }
}

export class AcquisitionCancelledError extends Error {
  constructor(message = "source acquisition was cancelled") {
    super(message);
    this.name = "AcquisitionCancelledError";
  }
}

export class AcquisitionFailedError extends Error {
  readonly errorCode: string;

  constructor(errorCode: string, message: string) {
    super(message);
    this.name = "AcquisitionFailedError";
    this.errorCode = errorCode;
  }
}

export class AcquisitionProgressError extends Error {
  readonly failure: unknown;
  readonly redirectCount: number;
  readonly finalUri: string;

  constructor(failure: unknown, redirectCount: number, finalUri: string) {
    super(failure instanceof Error ? failure.message : String(failure));
    this.name = "AcquisitionProgressError";
    this.failure = failure;
    this.redirectCount = redirectCount;
    this.finalUri = finalUri;
  }
}
