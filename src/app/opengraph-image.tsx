import { ImageResponse } from "next/og";

export const alt = "랜덤픽 — 돌을 던져서 오늘 점심을 정합니다";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * 카카오톡·슬랙 링크 미리보기 이미지.
 *
 * 이미지 안에는 **라틴 문자만** 넣습니다. ImageResponse에 번들된 폰트에는 한글
 * 글리프가 없어서 한글을 그리면 두부(□□□)가 됩니다. 한글 제목·설명은
 * `og:title`/`og:description` 텍스트로 전달되므로 미리보기 카드에는 정상적으로
 * 한글이 표시됩니다 — 이미지는 시각적 인상만 담당합니다.
 */
export default function OpengraphImage() {
  const rings = [
    { size: 300, opacity: 0.4 },
    { size: 460, opacity: 0.26 },
    { size: 640, opacity: 0.16 },
    { size: 840, opacity: 0.09 },
  ];

  const waves = [
    { top: 400, opacity: 0.16 },
    { top: 462, opacity: 0.12 },
    { top: 524, opacity: 0.085 },
    { top: 586, opacity: 0.055 },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "linear-gradient(160deg, #14606e 0%, #0d4552 55%, #06272f 100%)",
          overflow: "hidden",
          fontFamily: "sans-serif",
        }}
      >
        {/* 수면에 퍼지는 파문 */}
        {rings.map((ring) => (
          <div
            key={ring.size}
            style={{
              position: "absolute",
              left: 300 - ring.size / 2,
              top: 330 - ring.size / 2,
              width: ring.size,
              height: ring.size,
              borderRadius: ring.size,
              border: `3px solid rgba(220, 241, 244, ${ring.opacity})`,
            }}
          />
        ))}

        {/* 넘실대는 물결 — 납작한 타원을 겹쳐 수면 느낌을 냅니다 */}
        {waves.map((wave) => (
          <div
            key={wave.top}
            style={{
              position: "absolute",
              left: -160,
              top: wave.top,
              width: 1520,
              height: 150,
              borderRadius: 1520,
              border: `4px solid rgba(220, 241, 244, ${wave.opacity})`,
            }}
          />
        ))}

        {/* 조약돌 — Satori는 4값 border-radius를 지원하지 않으므로 타원으로 그립니다 */}
        <div
          style={{
            position: "absolute",
            left: 236,
            top: 292,
            width: 128,
            height: 78,
            borderRadius: 128,
            background:
              "linear-gradient(135deg, #cdd8d7 0%, #7d8b8b 52%, #2b3536 100%)",
            border: "2px solid rgba(240, 250, 251, 0.28)",
            transform: "rotate(-16deg)",
          }}
        />

        {/* 워드마크 */}
        <div
          style={{
            position: "absolute",
            left: 610,
            top: 214,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: 88,
              fontWeight: 800,
              color: "#f2fbfc",
              letterSpacing: -3,
              lineHeight: 1,
            }}
          >
            RANDOM
          </div>
          <div
            style={{
              fontSize: 88,
              fontWeight: 800,
              color: "#8fdbd0",
              letterSpacing: -3,
              lineHeight: 1.05,
            }}
          >
            PICK
          </div>
          <div
            style={{
              marginTop: 26,
              fontSize: 27,
              color: "rgba(220, 241, 244, 0.78)",
              letterSpacing: 0.5,
            }}
          >
            Lunch, decided by a skipping stone.
          </div>
        </div>

        {/* 하단 라벨 */}
        <div
          style={{
            position: "absolute",
            left: 610,
            top: 520,
            display: "flex",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 12,
              background: "#ff7c56",
              marginRight: 12,
            }}
          />
          <div
            style={{
              fontSize: 21,
              color: "rgba(220, 241, 244, 0.6)",
              letterSpacing: 2,
            }}
          >
            THROW · BOUNCE · REVEAL
          </div>
        </div>
      </div>
    ),
    size,
  );
}
