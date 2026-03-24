import { describe, expect, it, afterEach } from "@jest/globals";
import { hashDeviceFingerprintMaterial } from "../utils/fingerprintHash.js";

describe("hashDeviceFingerprintMaterial", () => {
  const prev = process.env.GOAT_FINGERPRINT_PEPPER;

  afterEach(() => {
    if (prev === undefined) delete process.env.GOAT_FINGERPRINT_PEPPER;
    else process.env.GOAT_FINGERPRINT_PEPPER = prev;
  });

  it("returns null when pepper is unset", () => {
    delete process.env.GOAT_FINGERPRINT_PEPPER;
    expect(hashDeviceFingerprintMaterial("device-abc")).toBeNull();
  });

  it("returns stable hex for same pepper and device id", () => {
    process.env.GOAT_FINGERPRINT_PEPPER = "test-pepper";
    const a = hashDeviceFingerprintMaterial("same-id");
    const b = hashDeviceFingerprintMaterial("same-id");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs when device id differs", () => {
    process.env.GOAT_FINGERPRINT_PEPPER = "test-pepper";
    expect(hashDeviceFingerprintMaterial("a")).not.toBe(hashDeviceFingerprintMaterial("b"));
  });

  it("explicit pepper overrides env", () => {
    process.env.GOAT_FINGERPRINT_PEPPER = "env-pepper";
    const withExplicit = hashDeviceFingerprintMaterial("id", "override-pepper");
    delete process.env.GOAT_FINGERPRINT_PEPPER;
    const onlyOverride = hashDeviceFingerprintMaterial("id", "override-pepper");
    expect(withExplicit).toBe(onlyOverride);
    expect(hashDeviceFingerprintMaterial("id", "env-pepper")).not.toBe(withExplicit);
  });
});
