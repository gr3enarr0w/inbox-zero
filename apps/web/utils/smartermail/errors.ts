export class SmarterMailApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "SmarterMailApiError";
    this.status = status;
  }
}

export class SmarterMailMessageNotFoundError extends SmarterMailApiError {
  constructor() {
    super("SmarterMail message was not found", 400);
    this.name = "SmarterMailMessageNotFoundError";
  }
}

export class SmarterMailMfaRequiredError extends Error {
  constructor() {
    super("SmarterMail requires a two-factor authentication code");
    this.name = "SmarterMailMfaRequiredError";
  }
}
