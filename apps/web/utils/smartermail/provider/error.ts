export class SmarterMailUnsupportedError extends Error {
  constructor(operation: string) {
    super(`SmarterMail does not currently support ${operation} in Inbox Zero`);
    this.name = "SmarterMailUnsupportedError";
  }
}
