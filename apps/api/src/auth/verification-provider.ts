export interface VerificationProvider {
  readonly mode: "mock" | "twilio";
  send(phoneE164: string): Promise<void>;
  check(phoneE164: string, code: string): Promise<boolean>;
}

export class MockVerificationProvider implements VerificationProvider {
  readonly mode = "mock" as const;
  readonly #code: string;
  readonly #requestedPhones = new Set<string>();

  constructor(code = "000000") {
    this.#code = code;
  }

  async send(phoneE164: string) {
    this.#requestedPhones.add(phoneE164);
  }

  async check(phoneE164: string, code: string) {
    return this.#requestedPhones.has(phoneE164) && code === this.#code;
  }
}
