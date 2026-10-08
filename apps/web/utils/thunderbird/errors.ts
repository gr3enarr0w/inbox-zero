export class ThunderbirdBridgeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ThunderbirdBridgeError";
  }
}
export class ThunderbirdUnsupportedError extends Error {
  constructor(capability: string) {
    super(`Thunderbird does not support ${capability}`);
    this.name = "ThunderbirdUnsupportedError";
  }
}
