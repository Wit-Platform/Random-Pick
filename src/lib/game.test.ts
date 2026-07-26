import { describe, expect, it } from "vitest";

import {
  categoryFromKakao,
  detailFromKakao,
  groupCodesFor,
  isExcludedByCategory,
} from "./categories";
import { PHYSICS, RADIUS } from "./config";
import { destination, distanceM, toRadians } from "./geo";
import { mockPlaces } from "./mock-places";
import {
  blurAfterBounce,
  landingOf,
  planThrow,
  pullToAim,
  revealRadiusM,
} from "./physics";
import { mulberry32 } from "./prng";
import { isValidRoomCode, normalizeRoomCode } from "./room-code";
import type { LatLng } from "./types";

const GANGNAM: LatLng = { lat: 37.4979, lng: 127.0276 };

describe("prng", () => {
  it("같은 시드는 같은 수열을 냅니다", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("다른 시드는 다른 수열을 냅니다", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("geo", () => {
  it("이동한 거리를 되짚으면 같은 값이 나옵니다", () => {
    const moved = destination(GANGNAM, toRadians(37), 800);
    expect(distanceM(GANGNAM, moved)).toBeCloseTo(800, 0);
  });

  it("방위 0도는 북쪽으로 갑니다", () => {
    const north = destination(GANGNAM, 0, 500);
    expect(north.lat).toBeGreaterThan(GANGNAM.lat);
    expect(north.lng).toBeCloseTo(GANGNAM.lng, 6);
  });
});

describe("mockPlaces", () => {
  it("같은 좌표를 조회하면 누구에게나 같은 결과입니다", () => {
    const first = mockPlaces(GANGNAM, 600);
    const second = mockPlaces(GANGNAM, 600);
    expect(first.map((p) => p.id)).toEqual(second.map((p) => p.id));
    expect(first.map((p) => p.name)).toEqual(second.map((p) => p.name));
  });

  it("반경 밖은 포함하지 않고, 거리순으로 정렬됩니다", () => {
    const places = mockPlaces(GANGNAM, 500);
    expect(places.length).toBeGreaterThan(0);
    let previous = 0;
    for (const place of places) {
      const d = distanceM(GANGNAM, place);
      expect(d).toBeLessThanOrEqual(500);
      expect(d).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = d;
    }
  });
});

describe("pullToAim", () => {
  it("당긴 반대 방향으로 날아갑니다 (슬링샷)", () => {
    // 남쪽으로 당기면 북쪽으로 발사 → 방위각 0
    const aim = pullToAim(0, 120);
    expect(aim.bearingRad).toBeCloseTo(0, 6);
  });

  it("최대 당김을 넘으면 파워가 1에서 멈춥니다", () => {
    expect(pullToAim(PHYSICS.maxPullPx * 3, 0).power).toBe(1);
  });
});

describe("planThrow", () => {
  it("같은 시드면 같은 궤적입니다", () => {
    const aim = { power: 0.7, bearingRad: 1.1 };
    const a = planThrow(GANGNAM, 1000, aim, mulberry32(99));
    const b = planThrow(GANGNAM, 1000, aim, mulberry32(99));
    expect(a).toEqual(b);
  });

  it("바운스 수와 각도 노이즈가 정해진 범위 안에 있습니다", () => {
    const limit = toRadians(PHYSICS.angleClampDeg);
    for (let seed = 0; seed < 400; seed++) {
      const plan = planThrow(
        GANGNAM,
        1000,
        { power: 0.6, bearingRad: 0.4 },
        mulberry32(seed),
      );
      expect(plan.bounces).toBeGreaterThanOrEqual(PHYSICS.bounceMin);
      expect(plan.bounces).toBeLessThanOrEqual(PHYSICS.bounceMax);
      expect(plan.points).toHaveLength(plan.bounces);
      expect(Math.abs(plan.bearingRad - 0.4)).toBeLessThanOrEqual(limit + 1e-9);
    }
  });

  it("홉 길이의 합이 총 비행거리와 같습니다", () => {
    const plan = planThrow(
      GANGNAM,
      1200,
      { power: 0.9, bearingRad: 2.2 },
      mulberry32(7),
    );
    const sum = plan.hopMeters.reduce((acc, m) => acc + m, 0);
    expect(sum).toBeCloseTo(plan.totalMeters, 6);
  });

  it("홉이 갈수록 짧아집니다 (감쇠)", () => {
    const plan = planThrow(
      GANGNAM,
      1000,
      { power: 0.8, bearingRad: 0 },
      mulberry32(3),
    );
    for (let i = 1; i < plan.hopMeters.length; i++) {
      expect(plan.hopMeters[i]!).toBeLessThan(plan.hopMeters[i - 1]!);
    }
  });

  it("착지점까지의 거리가 총 비행거리와 일치합니다", () => {
    const plan = planThrow(
      GANGNAM,
      1000,
      { power: 0.75, bearingRad: 1.9 },
      mulberry32(21),
    );
    expect(distanceM(GANGNAM, landingOf(plan))).toBeCloseTo(plan.totalMeters, 0);
  });

  it("최대 파워로 던지면 반경 밖으로 나갈 수 있습니다 (허탕 가능)", () => {
    let outside = 0;
    for (let seed = 0; seed < 200; seed++) {
      const plan = planThrow(
        GANGNAM,
        1000,
        { power: 1, bearingRad: 0 },
        mulberry32(seed),
      );
      if (plan.totalMeters > 1000) outside++;
    }
    expect(outside).toBeGreaterThan(0);
  });
});

describe("blur / reveal", () => {
  it("마지막 바운스에서 블러가 정확히 0이 됩니다", () => {
    expect(blurAfterBounce(4, 4)).toBe(0);
    expect(blurAfterBounce(0, 4)).toBe(PHYSICS.blurStartPx);
    expect(blurAfterBounce(2, 4)).toBeCloseTo(PHYSICS.blurStartPx / 2, 6);
  });

  it("판정 반경이 상·하한 안에 있습니다", () => {
    expect(revealRadiusM(RADIUS.min)).toBe(120);
    expect(revealRadiusM(1000)).toBe(300);
    expect(revealRadiusM(RADIUS.max)).toBe(500);
  });
});

describe("카카오 카테고리 매핑", () => {
  it("2번째 토큰으로 대분류를 정합니다", () => {
    expect(categoryFromKakao("음식점 > 한식 > 국밥")).toBe("ko");
    expect(categoryFromKakao("음식점 > 중식")).toBe("cn");
    expect(categoryFromKakao("음식점 > 일식 > 초밥,롤")).toBe("jp");
    expect(categoryFromKakao("음식점 > 분식")).toBe("bs");
    expect(categoryFromKakao("음식점 > 카페 > 커피전문점")).toBe("cf");
    expect(categoryFromKakao("음식점 > 피자")).toBe("we");
  });

  it("모르는 분류는 기타로 접습니다", () => {
    expect(categoryFromKakao("음식점 > 없는분류 > 무엇")).toBe("et");
    expect(categoryFromKakao("이상한값")).toBe("et");
  });

  it("점심 앱이므로 술집 계열은 제외합니다", () => {
    expect(isExcludedByCategory("음식점 > 술집 > 호프,요리주점")).toBe(true);
    expect(isExcludedByCategory("음식점 > 한식 > 국밥")).toBe(false);
  });

  it("세부 분류 표기에서 '음식점'은 떼어냅니다", () => {
    expect(detailFromKakao("음식점 > 한식 > 국밥")).toBe("한식 › 국밥");
  });

  it("카페만 고르면 FD6는 조회하지 않습니다", () => {
    expect(groupCodesFor(["cf"])).toEqual(["CE7"]);
    expect(groupCodesFor(["ko"])).toEqual(["FD6"]);
    expect(groupCodesFor(["ko", "cf"])).toEqual(["FD6", "CE7"]);
  });
});

describe("초대 코드", () => {
  it("혼동 문자를 보정합니다", () => {
    expect(normalizeRoomCode("ilo-23x")).toBe("11023X");
    expect(normalizeRoomCode("ab cd 12")).toBe("ABCD12");
  });

  it("6자리가 아니면 거부합니다", () => {
    expect(isValidRoomCode("ABC12")).toBe(false);
    expect(isValidRoomCode("ABC123")).toBe(true);
  });
});
