/** Every failure carries a stable machine code. The codes are part of the spec. */
export class LoglineError extends Error {
  constructor(public code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "LoglineError";
  }
}
