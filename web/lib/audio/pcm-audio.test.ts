import { expect, it } from "vitest";

import { decodePcm } from "./pcm-audio";

const base64 = (...bytes: number[]) => btoa(String.fromCharCode(...bytes));

it("decodes little-endian signed PCM16 to samples from -1 to 1", () => {
  // 0, 16384, the most negative sample, and -1.
  expect([...decodePcm(base64(0x00, 0x00, 0x00, 0x40, 0x00, 0x80, 0xff, 0xff))]).toEqual([0, 0.5, -1, -1 / 32768]);
});

it("rejects audio with half a sample", () => {
  expect(() => decodePcm(base64(0x00, 0x00, 0x00))).toThrow(/incomplete PCM16/);
});
