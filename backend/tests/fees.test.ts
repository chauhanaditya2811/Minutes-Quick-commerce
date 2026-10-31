import { describe, expect, it } from "vitest";
import {
  FeeRuleError,
  convenienceFeeFor,
  feesFor,
  isLateNight,
  parseFeeTiers,
  readFeeSettings,
  type FeeSettings,
} from "../src/services/fees.js";

const TIERS = [
  { minSubtotal: 0, fee: 10 },
  { minSubtotal: 60, fee: 15 },
  { minSubtotal: 100, fee: 20 },
];

/** A Date at this India time on an arbitrary day (India is UTC+5:30). */
const india = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 6, h!, m!) - (5 * 60 + 30) * 60_000);
};

describe("convenience fee ranges", () => {
  it.each([
    [0, 10],
    [45, 10],
    [59, 10],
    [60, 15],
    [99, 15],
    [100, 20],
    [500, 20],
  ])("charges an order of ₹%i a fee of ₹%i", (subtotal, fee) => {
    expect(convenienceFeeFor(subtotal, TIERS)).toBe(fee);
  });

  it("charges one flat fee when there is a single range", () => {
    expect(convenienceFeeFor(250, [{ minSubtotal: 0, fee: 12 }])).toBe(12);
  });

  it("accepts falling fees too (e.g. free on bigger orders)", () => {
    const tiers = parseFeeTiers([{ minSubtotal: 0, fee: 20 }, { minSubtotal: 150, fee: 0 }]);
    expect(convenienceFeeFor(149, tiers)).toBe(20);
    expect(convenienceFeeFor(150, tiers)).toBe(0);
  });

  it.each([
    ["no ranges", []],
    ["a first range above 0", [{ minSubtotal: 1, fee: 5 }]],
    ["ranges out of order", [{ minSubtotal: 0, fee: 5 }, { minSubtotal: 100, fee: 5 }, { minSubtotal: 50, fee: 5 }]],
    ["a repeated start", [{ minSubtotal: 0, fee: 5 }, { minSubtotal: 0, fee: 6 }]],
    ["a negative fee", [{ minSubtotal: 0, fee: -1 }]],
    ["a fractional start", [{ minSubtotal: 0, fee: 5 }, { minSubtotal: 59.5, fee: 6 }]],
    ["a non-list", { minSubtotal: 0, fee: 5 }],
  ])("rejects %s", (_label, input) => {
    expect(() => parseFeeTiers(input)).toThrow(FeeRuleError);
  });
});

describe("late-night window (India time)", () => {
  it.each([
    ["00:59", false],
    ["01:00", true],
    ["03:30", true],
    ["05:59", true],
    ["06:00", false],
    ["13:00", false],
  ])("01:00–06:00 at %s → %s", (time, expected) => {
    expect(isLateNight(india(time), "01:00", "06:00")).toBe(expected);
  });

  it.each([
    ["22:59", false],
    ["23:00", true],
    ["00:30", true],
    ["04:59", true],
    ["05:00", false],
  ])("23:00–05:00 (across midnight) at %s → %s", (time, expected) => {
    expect(isLateNight(india(time), "23:00", "05:00")).toBe(expected);
  });

  it("is never active when start and end are the same or invalid", () => {
    expect(isLateNight(india("01:00"), "01:00", "01:00")).toBe(false);
    expect(isLateNight(india("01:00"), "1am", "06:00")).toBe(false);
  });
});

describe("fees for an order", () => {
  const settings: FeeSettings = {
    feeTiers: TIERS,
    lateNightFeeEnabled: true,
    lateNightFee: 5,
    lateNightStart: "01:00",
    lateNightEnd: "06:00",
  };

  it("adds the late-night fee only inside its hours and only when switched on", () => {
    expect(feesFor(75, settings, india("02:00"))).toEqual({ convenienceFee: 15, lateNightFee: 5 });
    expect(feesFor(75, settings, india("21:00"))).toEqual({ convenienceFee: 15, lateNightFee: 0 });
    expect(feesFor(75, { ...settings, lateNightFeeEnabled: false }, india("02:00"))).toEqual({ convenienceFee: 15, lateNightFee: 0 });
  });

  it("falls back to the old flat fee and no late-night fee if the saved rules are missing or damaged", () => {
    expect(readFeeSettings({ deliveryFee: 7 })).toEqual({
      feeTiers: [{ minSubtotal: 0, fee: 7 }],
      lateNightFeeEnabled: false,
      lateNightFee: 0,
      lateNightStart: "01:00",
      lateNightEnd: "06:00",
    });
    expect(readFeeSettings({ deliveryFee: 7, feeTiers: [{ minSubtotal: 5, fee: 1 }] }).feeTiers).toEqual([{ minSubtotal: 0, fee: 7 }]);
  });
});
