import { describe, expect, it } from "vitest";
import { parseBlockFloor } from "../src/utils/blockFloor.js";

describe("parseBlockFloor", () => {
  it.each([
    ["A/2", "A/2"],
    ["a / 2", "A/2"],
    [" b-3 ", "B-3"],
    ["G", "G"],
    ["12", "12"],
    ["Block A  2", "BLOCK A 2"],
    [0, "0"],
    [4, "4"],
  ])("accepts %j as %j", (input, expected) => {
    expect(parseBlockFloor(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "/2",
    "A/",
    "A#2",
    "A\2",
    "<b>",
    "ABCDEFGHIJK",
    -1,
    2.5,
    Number.NaN,
    null,
    undefined,
    { floor: 2 },
  ])("rejects %j", (input) => {
    expect(parseBlockFloor(input)).toBeNull();
  });
});
