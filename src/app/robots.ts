import type { MetadataRoute } from "next";

import { SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // API는 색인 대상이 아니고, 크롤러가 두드리면 카카오 쿼터를 태웁니다
        disallow: "/api/",
      },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
