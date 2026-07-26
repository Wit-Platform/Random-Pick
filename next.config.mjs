/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * 클라이언트 소스맵을 배포하지 않습니다 (기본값이지만 명시해 둡니다).
   *
   * 클라이언트 코드 자체는 숨길 수 없습니다 — 브라우저가 실행하려면 사용자 기기에
   * 도달해야 합니다. 개발자도구 차단·우클릭 금지 같은 기법은 우회가 쉽고 스크린리더
   * 사용자만 불편하게 하므로 쓰지 않습니다.
   *
   * 실질적인 보호는 **비밀을 클라이언트에 두지 않는 것**입니다. 카카오 REST 키와
   * Upstash 토큰은 서버 라우트에만 있고 번들에 포함되지 않습니다. 카카오 JS 키는
   * 태생적으로 공개되며 등록 도메인으로 보호됩니다.
   */
  productionBrowserSourceMaps: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // MIME 스니핑으로 스크립트가 실행되는 것을 막습니다
          { key: "X-Content-Type-Options", value: "nosniff" },
          // 다른 사이트가 이 앱을 iframe에 넣어 클릭재킹하는 것을 막습니다
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // 위치 권한 외에는 필요하지 않습니다
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(), microphone=(), payment=()",
          },
        ],
      },
      {
        // API 응답이 검색엔진에 색인되거나 캐시되지 않게 합니다
        source: "/api/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
