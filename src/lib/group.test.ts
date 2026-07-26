import { describe, expect, it } from "vitest";

import { GROUP, RADIUS } from "./config";
import { parseCondition, sanitizeNick } from "./group";
import { mulberry32 } from "./prng";
import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  ROOM_CODE_LENGTH,
} from "./room-code";

const VALID = {
  base: { lat: 37.4979, lng: 127.0276 },
  radiusM: 1000,
  cats: ["ko", "jp"],
};

describe("parseCondition", () => {
  it("정상 입력을 통과시킵니다", () => {
    const parsed = parseCondition(VALID);
    expect(parsed).not.toBeNull();
    expect(parsed?.base).toEqual(VALID.base);
    expect(parsed?.radiusM).toBe(1000);
    expect(parsed?.cats).toEqual(["ko", "jp"]);
    expect(parsed?.createdAt).toBeGreaterThan(0);
  });

  it("객체가 아니면 거부합니다", () => {
    expect(parseCondition(null)).toBeNull();
    expect(parseCondition("문자열")).toBeNull();
    expect(parseCondition(42)).toBeNull();
  });

  it("기준점이 없거나 범위를 벗어나면 거부합니다", () => {
    expect(parseCondition({ ...VALID, base: undefined })).toBeNull();
    expect(parseCondition({ ...VALID, base: { lat: 91, lng: 127 } })).toBeNull();
    expect(parseCondition({ ...VALID, base: { lat: 37, lng: 181 } })).toBeNull();
    expect(
      parseCondition({ ...VALID, base: { lat: "abc", lng: 127 } }),
    ).toBeNull();
  });

  it("반경이 허용 범위를 벗어나면 거부합니다", () => {
    expect(parseCondition({ ...VALID, radiusM: RADIUS.min - 1 })).toBeNull();
    expect(parseCondition({ ...VALID, radiusM: RADIUS.max + 1 })).toBeNull();
    expect(parseCondition({ ...VALID, radiusM: RADIUS.min })).not.toBeNull();
    expect(parseCondition({ ...VALID, radiusM: RADIUS.max })).not.toBeNull();
  });

  it("카테고리가 비면 거부하고, 모르는 값은 걸러냅니다", () => {
    expect(parseCondition({ ...VALID, cats: [] })).toBeNull();
    expect(parseCondition({ ...VALID, cats: "ko" })).toBeNull();
    expect(parseCondition({ ...VALID, cats: ["없는값"] })).toBeNull();
    expect(parseCondition({ ...VALID, cats: ["ko", "없는값"] })?.cats).toEqual([
      "ko",
    ]);
  });
});

describe("sanitizeNick", () => {
  it("앞뒤 공백을 제거하고 길이를 자릅니다", () => {
    expect(sanitizeNick("  민수  ")).toBe("민수");
    expect(sanitizeNick("가".repeat(30))).toHaveLength(GROUP.maxNickLength);
  });

  it("빈 값과 문자열 아닌 값을 거부합니다", () => {
    expect(sanitizeNick("")).toBeNull();
    expect(sanitizeNick("   ")).toBeNull();
    expect(sanitizeNick(undefined)).toBeNull();
    expect(sanitizeNick(42)).toBeNull();
  });
});

describe("초대 코드 생성", () => {
  it("길이와 알파벳이 규격에 맞습니다", () => {
    const rand = mulberry32(4242);
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode(rand);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it("혼동되는 문자(I L O U)를 절대 쓰지 않습니다", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      expect(generateRoomCode(rand)).not.toMatch(/[ILOU]/);
    }
  });

  it("정규화는 멱등입니다", () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode(rand);
      expect(normalizeRoomCode(code)).toBe(code);
    }
  });

  it("사람이 잘못 적은 코드를 보정합니다", () => {
    // 손으로 옮겨 적을 때 흔히 섞이는 문자들
    expect(normalizeRoomCode("o1lz9i")).toBe("011Z91");
    expect(normalizeRoomCode("ab-cd-12")).toBe("ABCD12");
    expect(normalizeRoomCode("  x y z 1 2 3 ")).toBe("XYZ123");
  });

  it("길이가 다르면 거부합니다 — 잘라서 통과시키지 않습니다", () => {
    expect(isValidRoomCode("")).toBe(false);
    expect(isValidRoomCode("ABC12")).toBe(false);
    // 7자를 6자로 잘라 통과시키면 오타가 엉뚱한 방으로 들어갑니다
    expect(isValidRoomCode("ABC1234")).toBe(false);
    expect(isValidRoomCode("ABC123")).toBe(true);
    // 하이픈·공백은 코드 문자가 아니므로 길이에 세지 않습니다
    expect(isValidRoomCode("abc-123")).toBe(true);
  });
});
