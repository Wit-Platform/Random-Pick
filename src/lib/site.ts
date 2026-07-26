/**
 * 사이트 정체성. canonical URL과 링크 미리보기가 한 곳을 보게 모아둡니다.
 * 커스텀 도메인이 생기면 `NEXT_PUBLIC_SITE_URL`만 바꾸면 됩니다.
 */

export const SITE = {
  name: "랜덤픽",
  tagline: "점심 뭐먹을래?",
  title: "랜덤픽 — 점심 뭐먹을래?",
  description:
    "지도가 물로 덮이고, 돌을 던지면 수면 위를 통통 튀며 날아갑니다. 마지막 바운스에서 물이 빠지며 오늘 점심이 정해집니다. 반경과 음식 종류만 고르면 끝. 회원가입 없이 초대 코드로 같이 던질 수 있습니다.",
  /** 링크 미리보기에 쓰는 한 줄 — 카카오톡 카드에서 잘리지 않는 길이로 */
  shortDescription:
    "돌을 던져서 오늘 점심을 정합니다. 조준은 뜻대로 되지 않습니다.",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://random-pick-blush.vercel.app")
    .trim()
    .replace(/\/$/, ""),
  locale: "ko_KR",
} as const;
